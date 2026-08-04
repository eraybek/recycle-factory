# Minimal GDD — Recycle Factory

Mobil, dikey ekranda oynanan hypercasual fabrika kurma ve otomasyon oyunu.

**Durum:** İlk oynanabilir sürüm için tasarım kararları verilmiştir.

---

## 0. Dondurulmuş kararlar (v1)

Bu bölüm aşağıdaki bölümlerle çelişirse **bu bölüm geçerlidir.** Tasarım bu noktada kilitlenmiştir; değiştirmek ayrı ve açık bir karar gerektirir.

- **Tür:** Üstten kameralı, tek parmakla oynanan hybrid-casual idle tycoon.
- **Tek cümle:** Kirli bir mahalleyi temizleyip yerine büyüyen bir geri dönüşüm tesisi kuran oyun.
- **Çekirdek döngü (~30 sn):** Topla → hatta ver → işlenmiş ürünü sat → yükselt.
- **Para birimi tektir.** Çevre puanı ayrı bir kaynak değildir; yeşillenme, işlenen atığa göre ilerleyen **görsel ödüldür**. İkinci bir ekonomi dengelenmez.
- **Önce derinlik, sonra genişlik.** Tek bölgede gerçek üretim hattı bitmeden ikinci bölge açılmaz.
- **İlk hedef: oynanabilir dikey dilim.** 5–10 dakikalık, başı sonu belli bir demo. Offline kazanç, kayıt, analitik ve monetizasyon bu dilimin kapsamı **dışındadır**.

### Dikey dilim — durum

Biten:

- [x] Karakter + idle / yürüme / alma / bırakma animasyonları
- [x] Kucakta gerçek obje istifi (eldeki obje = yerdeki obje)
- [x] Açık dünya, yol ağı, collider'lar
- [x] Kirli arsa → toplama ve süpürme → zeminin asfaltlanması
- [x] Fabrika kabuğu: dört duvar, kapı, çatı yok
- [x] Yerdeki satın alma ped'leri (aşağıdan yukarıya dolum + para akışı)
- [x] Sıralı görev zinciri + dünya işaretçisi
- [x] Yeşillenme: renk geçişi ve ağaçların filizlenmesi
- [x] Yükseltme paneli: kapasite, hız, toplama menzili

- [x] Balya makinesi: atık fiziksel olarak girer, preslenir, balya çıkar
- [x] Balyayı elle taşıyıp satma (balya, ham atıktan çok daha değerli)
- [x] Kademeli açılım: yükseltmeler ve inşa alanları tek tek belirir

Kalan:

- [ ] Müşteri kuyruğu — kenarda tezgâh, atık torbasıyla gelen NPC'ler
- [ ] Alıcı kamyonu — servis yolundan gelip balyaları alması
- [ ] Dilimin kapanışı: net bir bitiş ekranı

### Öğretim sırası (değiştirilmez)

Oyuncuya her şey bir anda gösterilmez; her adım bir öncekini gerektirir:

1. Atık topla
2. Kutuya at, para kazan
3. Arsayı temizle ve süpür
4. Açılan alana balya makinesini kur
5. Makineye atık boşalt, çıkan balyayı eline al
6. Balyayı kutuya götür — çok daha fazla para
7. Duvarları çek, ikinci makineyi kur, kendini yükselt

Dilim dışı (sonraya): çalışanlar, otomasyon, offline kazanç, ikinci bölge, vatandaş teslimatı, monetizasyon.

---

## 1. Oyun Özeti

Oyuncu küçük ve kirli bir geri dönüşüm tesisiyle başlar. Başlangıçta sokaktaki atıkları kendisi toplar, tesise taşır, ayrıştırır, makinelerde işler ve satar.

Kazandığı parayla:

- yeni makineler açar,
- çalışanlar işe alır,
- taşıma ve üretim kapasitesini artırır,
- fabrikanın bölümlerini genişletir,
- manuel işleri otomatik hâle getirir.

Oyun ilerledikçe boş ve kirli alan, çalışan ve düzenli bir geri dönüşüm fabrikasına dönüşür.

## 2. Ana Oyun Döngüsü

1. Sokaktan atık topla.
2. Atıkları fabrikadaki ayrıştırma alanına götür.
3. Plastik ve metali birbirinden ayır.
4. Atıkları ilgili makinelere yükle.
5. İşlenmiş ürünleri makinelerden al.
6. Satış alanına götür.
7. Para kazan.
8. Makine, çalışan, kapasite veya yeni alan satın al.
9. Daha hızlı ve otomatik üretime geç.

## 3. Oyuncunun Rolü

Oyuncu fabrikanın sahibi ve ilk çalışanıdır.

Başlangıçta bütün işleri kendisi yapar: atık toplama, taşıma, ayrıştırma, makine besleme, ürün toplama, satış.

İlerleyen aşamalarda bu işleri çalışanlara ve otomasyon sistemlerine devreder.

Oyuncu tamamen pasif bir yönetici değil, fabrikada fiziksel olarak dolaşan aktif karakterdir.

## 4. Kontroller

**Mobil**

- Oyuncu, kullanıcı ekranda UI dışında herhangi bir yere dokunduğunda hareket eder.
- Joystick dokunulan noktada belirir.
- Parmağın hareket yönüne göre karakter hareket eder.
- Parmak kaldırıldığında joystick kaybolur.

**Masaüstü test**

- WASD
- Yön tuşları

**Etkileşim**

Günlük işlemler otomatik gerçekleşir: atık toplama, makineye ürün bırakma, ürün alma, para toplama, temizlik.

Satın alma işlemleri, oyuncunun satın alma alanında belirli süre durmasıyla gerçekleşir.

## 5. Kamera

- Kamera karakteri yukarıdan ve arkadan takip eder.
- Kamera, Pizza Ready benzeri oyunlarda olduğu gibi karakterden yeterince uzaktadır.
- Oyuncu döndüğünde kamera dönmez.
- Sokak ve fabrika tek kesintisiz haritanın parçalarıdır.
- Harita butonu geçici olarak daha geniş bir fabrika görünümü sunar.
- Normal oynanış çoğunlukla karakter takip kamerasıyla devam eder.

## 6. Atık Sistemi

İlk sürümde iki atık türü bulunur: **Plastik**, **Metal**.

Oyuncu sokakta karışık atık toplar. Toplanan atıklar çantada tek bir kapasite değerini doldurur.

Fabrikadaki ayrıştırma alanına girildiğinde karışık atıklar plastik ve metal olarak ayrılır.

İleride açılabilecek türler: Cam, Kâğıt, Elektronik atık.

## 7. Atık Kaynakları

İlerleme sırasına göre:

1. Oyuncu sokaktan atık toplar.
2. Vatandaşlar fabrikaya atık getirmeye başlar.
3. Çöp kamyonları toplu atık teslim eder.
4. Bütün kaynaklar aynı anda çalışmaya devam eder.

## 8. Taşıma Sistemi

Oyuncunun taşıma kapasitesi fiziksel ekipmanlarla gelişir:

1. Sırt çantası veya çuval
2. El arabası
3. Küçük elektrikli toplama aracı

Taşınan ürünler karakter üzerinde veya arkasında görsel olarak gösterilir.

## 9. Ayrıştırma Sistemi

Başlangıçta oyuncu ayrıştırma masasının yanında durarak atıkları ayırır.

İlerleme:

1. Manuel ayrıştırma masası
2. Hızlandırılmış ayrıştırma masası
3. Otomatik ayrıştırıcı
4. Sensörlü ayrıştırma sistemi

Manuel ayrıştırma, tek tek nesne sürükleme şeklinde değildir. Oyuncu alanda durur ve işlem otomatik ilerler.

## 10. Makine Sistemi

Her makinenin giriş kapasitesi, işlem süresi ve çıkış kapasitesi bulunur.

Örnek başlangıç döngüsü:

- 5 plastik veya metal girdisi
- yaklaşık 3 saniye işlem
- 1 sıkıştırılmış balya çıktısı

Makinenin çıkış alanı dolarsa üretim durur.

Makine giriş ve çıkışlarında ürünler fiziksel yığınlar hâlinde görünür.

## 11. İlk Üretim Hatları

**Plastik** — ilk sürüm:

`Karışık atık → Ayrıştırma → Plastik pres → Plastik balya → Satış`

İleri aşamalar: `Yıkama → Parçalama → Plastik granül → Paketleme`

**Metal** — ilk sürüm:

`Karışık atık → Ayrıştırma → Metal pres → Metal balya → Satış`

İleri aşamalar: `Manyetik ayrıştırma → Ezme → Eritme → Metal külçe`

## 12. Satış Sistemi

Başlangıçta oyuncu üretilen balyaları kendisi satış alanına taşır.

İlerleyen aşamalarda ürün deposu, taşıma çalışanı, yükleme alanı, alıcı kamyonu ve otomatik ödeme açılır.

Plastik ve metal farklı satış değerlerine sahiptir.

## 13. Çalışan Sistemi

Başlangıç çalışanları genel işçilerden oluşur.

İlerleyen aşamalarda çalışanlar uzmanlaşır: atık toplayıcı, ayrıştırma çalışanı, makine operatörü, ürün taşıyıcı, satış/yükleme çalışanı, temizlik çalışanı, bakım çalışanı.

Her çalışan belirli bir istasyona veya göreve atanır.

Çalışanlar ilgili makine veya alanın yanında bulunan satın alma bölgesinden işe alınır.

## 14. Otomasyon

Oyunun temel ilerleme hissi manuel işlerin otomasyona dönüşmesidir.

Örnek dönüşüm:

`Oyuncu taşıması → çalışan taşıması → konveyör sistemi → tamamen otomatik üretim hattı`

Otomasyon oyuncunun oyundan çıkarılması anlamına gelmez. Oyuncu yeni alan açma, yatırım yapma, görev tamamlama ve yeni üretim hatları kurmaya devam eder.

## 15. Temizlik ve Dünya Dönüşümü

Harita başlangıçta kirli, boş, dağınık ve az gelişmiş görünür.

Oyuncu sokaktaki çöp ve kirli bölgeleri temizleyebilir.

İlerleme sonucunda çevre temizlenir, yeşil alanlar artar, insanlar görünmeye başlar, fabrika büyür, yollar ve çevre düzenlenir, dünya daha canlı hâle gelir.

Temizlik başlangıçta oyuncu tarafından yapılır, daha sonra çalışanlarla otomatikleştirilebilir.

## 16. Ekonomi

İlk sürümde yalnızca tek para birimi bulunur: **Para**.

Para şu kaynaklardan kazanılır: işlenmiş ürün satışı, temizlik ödülleri, görevler, siparişler.

İlk sürümde karmaşık enerji, çevre puanı veya premium para sistemi bulunmaz. Çevre puanı ileride eklenebilir.

## 17. Satın Alma ve Yükseltmeler

**Fiziksel satın almalar** — oyuncu satın alma alanında durur:

- yeni makine
- yeni fabrika bölümü
- çalışan
- depo
- konveyör
- satış alanı

**Sayısal yükseltmeler** — menü veya yükseltme alanından yapılır:

- hareket hızı
- taşıma kapasitesi
- makine hızı
- makine kapasitesi
- çalışan hızı
- ürün değeri
- offline kazanç süresi

## 18. Görev Sistemi

Oyunda üç görev türü bulunur:

**Ana görevler** — oyuncuya fabrika ilerlemesini öğretir. Örnek: 5 atık topla, atıkları ayrıştır, ilk plastik balyayı üret, ilk çalışanı işe al, metal presini aç.

**Siparişler** — belirli miktarda ürün teslim edilmesini ister.

**Özel olaylar** — zaman zaman ek ödül veya kısa süreli hedef sunar.

Normal oynanışta sert başarısızlık veya fabrika batışı bulunmaz.

## 19. Offline Kazanç

Oyuncu oyunda değilken fabrika sınırlı süre üretmeye devam eder.

Offline kazanç belirli bir süreyle sınırlıdır, oyuncu geri döndüğünde tek ekrandan alınır ve ilerlemeyle kapasitesi artırılabilir.

## 20. Görsel Stil

- Renkli ve temiz low-poly 3D
- Hypercasual mobil oyun görünümü
- Büyük ve kolay okunan objeler
- Yumuşak gölgeler
- Belirgin üretim alanları
- Kalabalık olmayan sahne düzeni

Karakterler:

- büyük yuvarlak kafa
- kısa gövde
- kısa ve yumuşak uzuvlar
- sade kıyafetler
- uzaktan okunabilir silüetler
- kollar aşağıda nötr idle
- yürürken yumuşak kol ve bacak hareketleri

## 21. Arayüz

HUD mümkün olduğunca sade tutulur.

Sürekli görünen bilgiler: para, taşıma kapasitesi, mevcut ana görev, harita butonu.

Makine bilgileri yalnızca oyuncu makineye yaklaştığında görünür: giriş miktarı, çıkış miktarı, işlem ilerlemesi, doluluk durumu.

## 22. İlk Oynanabilir Sürüm Kapsamı

İlk vertical slice şunları içerecektir:

- Tek sokak ve fabrika alanı
- Oyuncu kontrollü karakter
- Mobil joystick
- Plastik ve metal atıkları
- 8 birim başlangıç taşıma kapasitesi
- Ayrıştırma alanı
- Plastik pres
- Metal pres
- Fiziksel giriş ve çıkış yığınları
- Ürünleri satış alanına taşıma
- Para kazanma
- Temizlik mekaniği
- Temel görev yönlendirmeleri
- Birkaç satın alma alanı
- İlk çalışan veya otomasyon yükseltmesi

## 23. Uzun Vadeli İlerleme

Bir fabrika tamamen geliştirildiğinde oyuncu yeni şehir veya tesise geçer.

Yeni tesislerde farklı çevre, yeni atık türleri, daha uzun üretim zincirleri, daha gelişmiş makineler, daha büyük araçlar ve daha karmaşık otomasyon sistemleri açılır.

Her yeni tesis başlangıçta kısmen manuel olur, fakat önceki ilerlemelerin bir bölümü korunabilir.

## 24. Para Kazanma Modeli

İlk oynanabilir sürüm reklamsız olacaktır.

İleride eklenebilir: isteğe bağlı ödüllü reklam, offline kazancı artırma, geçici üretim hızı bonusu, ek sipariş, kozmetik karakter veya fabrika görünümü.

Zorunlu reklam düşünülmemektedir.
