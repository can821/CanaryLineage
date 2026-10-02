# Can için kısa sözlük

Önce `npm run demo` ile üç senaryoyu dene. Sonra `src/service.js` dosyasını oku: depolama ve HTTP çağrısı aynı işin iki adımıdır. HTTP hata verince önceki depolama kaydının neden kaldığını ekrandan takip et.

| Kavram | Türkçesi / anlamı | CanaryLineage'daki görevi ve örnek |
|---|---|---|
| Browser | Tarayıcı | Formu gösterir; Trace çalıştır düğmesine basarsın. |
| Server | Sunucu program | Node.js isteği alır, işlemleri yürütür ve yanıt verir. |
| Request | İstek | Tarayıcının gönderdiği mesaj: “bu canary'yi kaydet”. |
| Response | Yanıt | Sunucunun sonucu: başarılı kayıt için 201 ve trace JSON'u. |
| API | Programların konuşma arayüzü | Form, backend ile HTTP ve JSON üzerinden konuşur. |
| Endpoint | API'nin belirli adresi | `POST /api/signup` kayıt işleminin girişidir. |
| Function | Fonksiyon / görev yapan kod | `createUser()` depolama ve isteğe bağlı HTTP adımlarını çağırır. |
| Database | Veritabanı | Kaydı uygulamadan bağımsız saklar; örnek: `users.email`. Demo belleği bunun yerine geçmez. |
| PostgreSQL | Kullanılan veritabanı yazılımı | Gerçek modda kullanıcı ve trace tablolarını saklar; bu ortamda çalışması henüz doğrulanamadı. |
| Trace | Tek işlemin yolculuk kaydı | Browser, endpoint, service ve iki sink olayını birleştirir. |
| Trace ID | Yolculuğun benzersiz kimliği | Aynı anda iki istek geldiğinde kayıtları ayırır. |
| Middleware | İsteği karşılayan ara katman | `traceRequest()` girdiyi doğrular ve context'i başlatır. |
| AsyncLocalStorage | Async iş boyunca bağlam saklama | Veritabanını beklerken hangi trace'te olduğumuzu korur; her fonksiyona trace ID parametresi gerekmez. |
| Instrumentation | Gözlem noktası ekleme | Service wrapper'ı ve HTTP yardımcısı olayları ortak formatta üretir. Her şeyi otomatik keşfetmez. |
| Concurrency | Birden fazla işin birlikte ilerlemesi | Testler istekleri aynı anda bekletir; A'nın olayının B'ye karışmadığını kontrol eder. |
| Outbound HTTP | Uygulamadan çıkan HTTP isteği | Sentetik email yerel mock servise POST edilir. Gerçek e-posta gönderilmez. |
| Test | Beklenen davranışı otomatik kontrol | HTTP 503 verince storage SUCCESS ve HTTP FAILED kaldığını doğrular. |
| Git commit | Değişikliklerin isimli kaydı | Çalışan milestone'u geçmişe ekler; otomatik olarak GitHub'a yüklemez. |
| README | Projenin giriş ve kullanım belgesi | Ne yaptığını, nasıl açılacağını ve doğrulanmamış kısmı gösterir. |

## İki kritik ayrım

**Parent ilişkisi:** İki olay aynı service tarafından çağrıldıysa kardeştir. Dallanma çizgisi aynı anda çalıştıkları anlamına gelmez; bu uygulama depolamayı bekler, ardından HTTP gönderir.

**Transaction:** PostgreSQL kullanıcıyı ve başlangıç trace'ini birlikte saklar. Sonraki HTTP isteği bu transaction'a dahil değildir. HTTP hatası önceki kaydı silemez. Son trace için ayrı UPDATE vardır; uygulama arada kapanırsa kayıt pending kalabilir.

## Kendin kontrol et

1. Depolama + HTTP çalıştır; iki sink'in parent bilgisini aç.
2. Yeni değer üret, HTTP hata senaryosunu çalıştır. Başarılı depolama olayını bul.
3. Depolamadan yeniden oku; hata trace'inin korunabildiğini gör.
4. `npm run verify` çalıştır. Testlerin geçmesi PostgreSQL motorunun burada denendiği anlamına gelmez; onun komutu `npm run test:postgres` ve ayrı veritabanı gerektirir.

CV'de şu sınırı koru: “Node.js/Express üzerinde seçilmiş sınırları instrument eden, async context ile sentetik veri akışını ilişkilendiren prototip.” “Tüm uygulamalarda otomatik hassas veri keşfi” iddiası bu projeyi tarif etmez.


## V1: hedef karşılaştırma

- **Sink / hedef:** Verinin yazıldığı veya gönderilmeye çalışıldığı yer. Burada users.email ve yerel HTTP servisi. Verinin nereye gittiğini somutlaştırır.
- **Baseline / başlangıç örneği:** Karşılaştırmanın eski tarafı. Depolama-only trace'i seçince yeni HTTP hedefi fark edilir.
- **Normalleştirme:** Aynı yeri aynı adla tanımak. Saat, süre ve rastgele port değişince sahte yeni hedef üretmez.
- **Küme farkı:** İki hedef listesindeki eklenen, çıkan ve ortak yerler. Aynı hedefe iki çağrı yapmak yeni hedef sayılmaz.
- **Deneme ve başarı:** HTTP hatası hedefe hiç gidilmediğini kanıtlamaz. Karşılaştırma hedefi sayar; trace ayrıca işlemin sonucunu gösterir.
- **Kalıcılık:** Program kapansa da verinin kalması. Gerçek PostgreSQL testinde yazan program kapandı, yeni program aynı trace'i okuyabildi. Bu sonucu Can normal Terminal'de doğruladı.
