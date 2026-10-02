# PostgreSQL'i normal Mac Terminali'nde doğrulama

Durum: **PostgreSQL VERIFIED — kullanıcının normal macOS Terminali’nde bildirdiği başarılı gerçek doğrulama (1 Ekim 2026).** Work ortamının başlangıç kısıtı devam eder; başarılı yürütme Work tarafından yapılmadı.

1 Ekim 2026: mevcut PostgreSQL 17.10 `initdb`, varsayılan ayarlarla ve tek bir `shared_memory_type=mmap` / `dynamic_shared_memory_type=mmap` denemesinde `shmget(... size=56 ...): Operation not permitted` hatası verdi. PostgreSQL sunucusu başlamadı. Docker/Homebrew PostgreSQL/Postgres.app ve standart 5432 portunda çalışan servis bulunmadı. Uygulamanın PostgreSQL adapter'ı bu nedenle değiştirilmedi.

PostgreSQL'in mmap kullanırken bile küçük bir System V bölgesine ihtiyaç duyabilmesi [resmî belgede](https://www.postgresql.org/docs/17/kernel-resources.html) açıklanır. Sistem güvenlik/çekirdek ayarlarını değiştirmiyoruz.

## Tek doğrulama akışı

Node.js 24 ve npm gerekir. Projede bağımlılıklar eksikse `npm ci` çalıştır (proje bağımlılıklarını indirir; PostgreSQL kurmaz).

### Hazır PostgreSQL çalıştırıcılarıyla geçici test

`PG_BIN` mevcut `initdb` ve `pg_ctl` dosyalarının bulunduğu klasördür; bu komut hiçbir yazılım kurmaz:

```sh
cd canary-lineage
PG_BIN="/path/to/existing/postgresql/bin" npm run verify:postgres -- --temporary
```

`PG_BIN` için kendi kurulumundaki bin klasörünü kullan. Bu yol makineye göre değişir.

Akış geçici dizinde rastgele parolalı gerçek PostgreSQL oluşturur. Sadece 127.0.0.1'e bağlanır; Unix socket kapalıdır. Gerçek testler bitince sunucuyu kapatır ve yalnızca kendi geçici dosyalarını siler. Test verisi kalıcı demo verisi değildir. Kapatma doğrulanamazsa dosyalar korunur ve FAIL yazılır.

### Zaten çalışan yerel PostgreSQL ile aynı akış

`.env.example` dosyasını `.env` olarak kopyala; mevcut dosyan varsa üzerine yazma. `TEST_DATABASE_URL` değerini yalnızca test için ayırdığın yerel veritabanına göre doldur. Ardından:

```sh
npm run verify:postgres
```

`psql` veya `pg_isready` gerekmez; bağlantı mevcut Node PostgreSQL sürücüsü ile kontrol edilir. Yanlış/eksik ayar, uzak adres, bağlantı veya test hatası FAIL ve sıfırdan farklı çıkış kodu üretir. Ham sürücü hataları/parolalar çıktıya yazılmaz. Belleğe geçiş yoktur.

## PASS neyi kanıtlar?

- Gerçek PostgreSQL bağlantısı; ayrı rastgele test schema'sında tabloların oluşturulması.
- Gerçek kullanıcı INSERT'i ve trace saklama/okuma.
- Aynı akışta gerçek localhost HTTP çıkışı ve başarısız HTTP sonrası başarılı DB kaydının korunması.
- Transaction rollback ve eşzamanlı kayıt/duplicate davranışı.
- Ayrı bir uygulama process'i trace üretir ve tamamen kapanır; yeni process aynı trace'i PostgreSQL'den okur.

Test schema'sı sonunda kaldırılır. Mevcut kullanıcı tablolarına yazılmaz. `npm run test:postgres` aynı entegrasyon testini doğrudan çalıştırır, ancak önce bir sunucu ve TEST_DATABASE_URL gerekir.

Kullanıcı bu workflow için gerçek bağlantı ve schema/INSERT/HTTP/transaction/process-restart PASS satırlarını bildirdi. Ayrıntılı kanıt kaydı: [VERIFICATION.md](VERIFICATION.md).

## Kalıcı uygulama kullanımı

Normal yerel PostgreSQL servisinde uygulama veritabanı oluşturulduktan ve `.env` içindeki DATABASE_URL doldurulduktan sonra mevcut `npm run db:init` ve `npm start` komutlarını kullan. Geçici doğrulama akışı kalıcı servis kurmaz. İşletim sistemi ayarlarını değiştirmez; kurulum yapmaz.
