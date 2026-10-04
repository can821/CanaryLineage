# CanaryLineage çalışma kuralları

- Bu repository CanaryLineage'ın ana geliştirme alanıdır. Mevcut çalışan kodu temel al; yeni bir paralel proje oluşturma.
- v0.1 kapsamı: Node.js, Express, PostgreSQL, hafif HTML trace konsolu; Browser → POST /api/signup → createUser() → users.email ve yerel mock HTTP sink. HTTP dalı kullanıcı tarafından açıkça istendi.
- Auth, ödeme, SaaS, AI, gerçek üçüncü taraf API, microservice altyapısı, yeni framework veya React/Next.js ekleme. V1 kapsamına iki trace arasında eklenen/çıkan/aynı kalan hedefleri karşılaştırma dahildir. PostgreSQL kullanıcı tarafından normal macOS Terminali’nde doğrulandı; Work’ün doğruladığını iddia etme.
- Can Git/backend öğreniyor. Önemli kararları kısa Türkçe açıklamalarla, dosyanın görevi ve veri akışı üzerinden anlat. Gereksiz teorik ders veya satır satır yorum ekleme.
- Tracker açık instrumentation kullanır; otomatik taint analysis veya tüm veri akışlarını keşif iddiasında bulunma. Browser bildiriminin istemci beyanı olduğunu koru.
- Bellek demosunu gerçek PostgreSQL gibi sunma; veritabanı hatasında otomatik fallback ekleme. Kullanıcı ve pending trace ilk transaction'da saklanır; HTTP sonrasında trace finalization ayrı UPDATE'dir. HTTP hatası önceki DB commit'ini geri almaz. Son trace saklanmadan tüm isteği başarılı gösterme.
- Secret commit etme. `.env` ve yerel veritabanı dosyaları Git dışında kalmalı.
- Kod değişiklikleri için `npm run verify`; SQL/depolama değişiklikleri için mümkünse ayrıca `npm run test:postgres` çalıştır. Gerçek veritabanı yoksa bu doğrulamayı açık olarak raporla.
- Milestone durumları README'de, doğrulama kanıtı `docs/VERIFICATION.md` içinde tutulur. Çalışan ve doğrulanmamış kısımları ayrı belirt.
- Kapanışta proje ağacı, basit mimari, milestone'lar, test sonuçları, çalıştırma, sınırlar ve sıradaki mantıklı adımı kısa özetle.

- v0.2 SDK: çoklu sentetik canary, açık derive, PostgreSQL read/write, sınırlar ve open/strict davranışı eklendi. Schema-v1 demo semantiğini koru. SDK schema-v2 kullanır; dağıtık propagation/queue/policy/UI desteği henüz yok.

- v0.3: Kullanıcının sonraki kapsam talebiyle açık dağıtık HTTP/job context, graph/diff/policy ve CLI eklendi. Güncel kapsam docs/DISTRIBUTED.md, doğrulama docs/VERIFICATION.md içindedir. UI tek servisli demo olarak kalır. Bu tur gerçek geçici PostgreSQL doğrulaması ajan tarafından çalıştırıldı; eski sürüm notları tarihsel kayıttır.
