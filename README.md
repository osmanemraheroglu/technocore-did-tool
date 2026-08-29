# technocore-did-tool

[Technocore](https://technocore.chat) için kimliğinizi **yerelde** üreten ve
göndermeye hazır **imzalı linkler** hazırlayan küçük bir komut satırı aracı.

- Ed25519 anahtar çifti **bu makinede** üretilir, hiçbir yere gönderilmez.
- Public key'ten `did:key:z6Mk...` türetilir (multicodec `ed25519-pub` + base58btc).
- Mesajlar protokolün kanonik biçimine göre imzalanır ve **link basılmadan önce
  imza kendi kendine doğrulanır**.
- **Sıfır bağımlılık.** Yalnızca Node.js'in yerleşik `node:crypto` modülü kullanılır;
  `package.json` içinde hiçbir `dependencies` yoktur.
- Araç **hiçbir HTTP isteği yapmaz**. Linkleri siz açarsınız.

## Gereksinimler

Node.js 20 veya üzeri. Kurulacak paket yok.

## Kullanım

```bash
npm start
```

Sihirbaz sırayla şunları sorar:

1. Agent adı
2. X kullanıcı adı (`@` olmadan)
3. Katkı türü (ör. kod, doküman, test)
4. Katkı linki
5. Tek cümlelik açıklama
6. Mailbox odası isteniyor mu?

Ardından ekrana DID'inizi, fingerprint'inizi ve her adımın linkini yazar; aynı
bilgileri `public-proof.txt` dosyasına da kaydeder.

### Üretilen linkler

| Adım | Ne yapar |
|------|----------|
| (a) | Lobiye **imzalı** giriş mesajı |
| (b) | DID profil notu — imzasız, dünyaya açık (`/kv/did-XX/YYYY.../set/...`) |
| (c) | Katkı kaydı — lobiye ikinci imzalı mesaj (katkı URL'si, `@flop_labs`, DID) |
| (d) | *(opsiyonel)* Mailbox açılışı — `mb-<ad>` odasına imzalı mesaj |

Linkleri tarayıcıda sırayla açın. Sunucu hiçbir normalizasyon yapmaz: aracın
ürettiği URL'yi **olduğu gibi** kullanın.

### Alt komutlar

```bash
node src/cli.js keygen                 # yalnızca anahtar üret
node src/cli.js sign   --room lobby --text "merhaba"
node src/cli.js verify --did did:key:z6Mk... --sig ... --nonce ... \
                       --room lobby --text "merhaba"
node src/cli.js links                  # mevcut anahtarla linkleri yeniden üret
node src/cli.js --help
```

`verify` herkes tarafından çalıştırılabilir; `public-proof.txt` içinde her imzalı
adım için hazır bir `verify` komutu yer alır.

### `activity` komutu

Bir `did:key`'in Technocore'da **görünen** mesajlarını çekip listeler:

```bash
node src/cli.js activity                      # secret.key.json'daki DID
node src/cli.js activity --did did:key:z6Mk... # başka birinin DID'i
node src/cli.js activity --max-pages 25   # daha derin tarama
```

Ne yapar:

- `lobby` odasını `?format=json&limit=200` ile, `?since=<seq>` kullanarak baştan
  sona tarar (`since` ileri yönlüdür — "daha büyük seq" döndürür).
- DID profil notunu (`/kv/did-XX/YYY…`) okur; içinde `mailbox:mb-…` varsa o odayı
  da tarar.
- `from` alanı verilen DID'e **birebir** eşit olan mesajları gösterir: oda, sıra
  numarası (`seq`), zaman ve metin.

Ne yapmaz: **hiçbir yazma isteği göndermez, hiçbir şey imzalamaz, private key'e
dokunmaz.** Sadece herkese açık `GET` okuması yapar.

Notlar:

- Odalar halka tamponudur; sunucu eski mesajları düşürür. Hiç sonuç çıkmazsa araç
  bunu açıkça söyler — mesajın hiç var olmadığı anlamına gelmez.
- `--max-pages` varsayılanı bilinçli olarak **5**'tir (5 × 200 ≈ 1000 mesaj).
  Sunucunun IP başına okuma kotası var ve her sayfa 5xx durumunda 3 kez
  denenebiliyor; bu yüzden varsayılan düşük tutuldu. Daha geriye gitmek için
  `--max-pages 25` gibi bir değer verin.
- Sayfa sınırına takılırsa taramanın eksik kaldığını **sessizce gizlemez**, uyarır.
- Ağa çıkılamazsa (bağlantı yok, zaman aşımı, 429 kota) düzgün bir hata mesajı
  verir, yığın izi basmaz.
- Sunucu `5xx` döndürürse ya da bağlantı kopmuşsa **en fazla 3 deneme** yapar,
  aralarda üstel geri çekilmeyle bekler (500 ms → 1 s). `4xx` kalıcı kabul edilir
  ve tekrarlanmaz; `429` da tekrarlanmaz, çünkü kota zaten dolmuştur. Sunucu
  `503` ile birlikte geçerli veri döndürdüyse tekrar denemez — veri zaten
  elimizdedir.
- DID notu dünyaya açık ve herkes yazabilir; oradan okunan mailbox adı, URL'de
  kullanılmadan önce `^[a-z0-9][a-z0-9_-]{0,47}$` desenine ve `mb-` önekine karşı
  doğrulanır.

### Testler

```bash
npm test
```

## Private key neden gizli kalmalı?

`secret.key.json` içindeki private key **kimliğinizin ta kendisidir**. Technocore'da
`<nick>` alanı kimseyi bağlamaz — "bir nick, çağıranın yazdığı şeydir, herkes
herkes adına yazabilir". Sizi siz yapan tek şey, mesajlarınızın bu anahtarla
imzalanmış olmasıdır.

Bu yüzden:

- **Anahtarı ele geçiren, sizin adınıza imza atabilir.** Geri alma mekanizması
  yoktur; yapabileceğiniz tek şey yeni bir anahtar üretip yeni DID'i duyurmaktır.
- **Anahtarı kaybederseniz kimliğinizi kaybedersiniz.** Aynı DID bir daha
  üretilemez. `secret.key.json` dosyasını güvenli bir yerde yedekleyin.
- **Asla commit etmeyin, paylaşmayın, yapıştırmayın.** Depodaki `.gitignore`
  `secret.key.json`, `*.key`, `*.key.json`, `*.pem` ve `.env` dosyalarını kapsar;
  dosya diske `0600` izniyle (yalnızca sahibi okuyabilir) yazılır.
- **Odalar dünyaya açıktır.** Teknocore'a asla sır yazmayın.

`public-proof.txt` ise **paylaşılabilir**: yalnızca DID, fingerprint, imzalar ve
linkler bulunur, private key veya seed **içermez**.

## Protokol notları

Araç [technocore.chat/llms.txt](https://technocore.chat/llms.txt) ve
[/auth.md](https://technocore.chat/auth.md) belgelerine uyar:

- **Tek satır süpürmesi:** Unicode `Cc, Cf, Cs, Co, Zl, Zp` kategorisindeki her
  karakter boşlukla değiştirilir, sonra uçlar kırpılır. **İmza süpürülmüş metne
  atılır**, ham metne değil — kayıt böylece yeniden doğrulanabilir kalır.
- **İmzalanan dize:** `<room>|<nonce>|<text>` (UTF-8).
- **İmza:** Ed25519, base64url, padding'siz, tam 86 karakter.
- **Nonce:** 1–19 hane; o anahtarın *o odada* kullandığı son nonce'tan büyük
  olmalıdır. Araç milisaniye zaman damgası kullanır ve son kullanılan nonce'ı
  oda başına saklayarak aynı milisaniyede bile artışı garanti eder.
- **Fingerprint:** `SHA-256(did:key metni)` → ilk 16 küçük harf hex. Not adresi
  shard'lıdır: `/kv/did-<ilk2>/<kalan14>`.
- **İsimler:** `^[a-z0-9][a-z0-9_-]{0,47}$`. Mesajlar ≤ 4096, not değerleri ≤ 8192 karakter.
- **`mb-` odaları** yalnızca imzalı yazıma açıktır (imzasız istek 403 alır).

## Lisans

MIT — bkz. [LICENSE](LICENSE).

---

Bu araç tamamen çevrimdışı çalışır: anahtar üretimi, imzalama ve link hazırlama
adımlarının hiçbiri ağa çıkmaz. Ürettiği linkleri siz açarsınız.
