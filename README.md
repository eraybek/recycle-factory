# Recycle Factory

Mobil dikey ekranda oynanan, Three.js tabanlı low-poly bir işletme ve otomasyon oyunu.

Oyuncu küçük ve kirli bir geri dönüşüm alanında sokaktan atık toplayarak başlar. Zamanla vatandaş teslimatları, çöp kamyonları, çalışanlar, yeni makineler ve otomatik üretim hatları açılır. Ana hedef; manuel çalışan küçük alanı, canlı ve büyük bir geri dönüşüm tesisine dönüştürmektir.

## Oynanabilir test sürümü

En güncel geliştirme sürümü her `main` veya `feat/**` güncellemesinde GitHub Pages'e otomatik dağıtılır:

https://eraybek.github.io/recycle-factory/

## Temel oyun döngüsü

İlk oynanabilir çekirdek bilerek en basit hâlde tutulur:

1. Yerdeki atıkların üstünden geçerek topla.
2. Atıklar karakterin elinde üst üste birikir.
3. Dolunca merkezdeki recycle noktasına git.
4. Atıkları otomatik boşaltıp para kazan.
5. Parayla kapasite, hız veya ilk fabrika adımını geliştir.

Ayrıştırma, makine işleme, çalışanlar ve otomasyon bu çekirdeğin üstüne eklenir.

## Tasarım kararları

- Platform: mobil, dikey ekran.
- Teknoloji: Vite, TypeScript ve Three.js.
- Kamera: oyuncuyu üstten ve eğimli açıyla takip eder; harita/yerleşim görünümünde uzaklaşır.
- Kontrol: dokunulan noktada beliren sanal joystick.
- Etkileşim: rutin işlemler otomatik; satın alma alanlarında bekleme kullanılır.
- Taşıma ilerlemesi: çuval, el arabası, elektrikli toplama aracı.
- Atık kaynakları: önce sokak, sonra vatandaşlar, ardından çöp kamyonları; ileride hepsi eşzamanlı.
- Başlangıç atıkları: plastik ve metal. Cam, kâğıt ve elektronik atık daha sonra açılır.
- Ayrıştırma: başlangıçta manuel masa, ileride otomatik ve sensörlü ayırıcı.
- Üretim: kapasite dolunca kısa işlem süresi ve fiziksel çıktı yığını.
- Satış: başlangıçta oyuncu taşır; ileride depo, çalışan ve alıcı kamyon sistemi açılır.
- Çalışanlar: istasyona özel atanır ve ilgili satın alma alanında bekleyerek işe alınır.
- Bakım: ileri aşamalarda makine arızaları ve bakım çalışanı.
- Temizlik: kirli alanları temizleme ve tesisin görsel dönüşümü.
- İlerleme: bir tesis birkaç aşamada tamamlanır, sonra yeni şehir ve tesis açılır.
- Monetizasyon: önce reklamsız oynanabilir MVP; daha sonra isteğe bağlı ödüllü reklamlar.

## Şu anki oynanabilir hâli

Dünya tek parça ve açık: yeşil alanlar, tesisi çevreleyen bir çevre yolu ve dört ana yol. Hiçbir yer kilitli değil, her taraf atık dolu. Tesis haritanın merkezindeki avluda adım adım kurulur.

- Üstünden geçince atık toplama; objeler kucakta gerçek hâlleriyle istiflenir
- Alma ve bırakma animasyonları
- Atıkları herhangi bir merkez recycle kutusuna boşaltarak para kazanma
- Tesisi sırayla inşa etme: ayrıştırma alanı → plastik pres → metal pres → satış noktası
- Aynı anda yalnızca sıradaki inşa alanı yerde durur; her biri atığın değerini artırır
- Panelden kademeli yükseltmeler: taşıma kapasitesi, hareket hızı, toplama menzili
- Tüm haritayı gösteren harita görünümü

## Açılış akışı

1. Merkezdeki arsa kirli ve çöp doludur; kenarda tek bir geri dönüşüm kutusu vardır.
2. Oyuncu arsadaki çöpleri toplar ve lekeleri süpürür — arsa temizlendikçe zemin asfaltlanır.
3. Arsa tamamen temizlenince fabrika kurulabilir: önce dört duvar ve bir kapı çekilir, çatı bilerek yoktur ki üretim alanı yukarıdan görünsün.
4. Çevredeki sokak çöpleri toplanmaya devam eder ve para kazandırır; makineler bu parayla duvarların içine tek tek kurulur.

## Go Green kurgusu

Oyun tek bir kirli mahalleyle başlar ve oyuncu orayı temizledikçe bölge gözle görülür şekilde yeşerir.

- **İki ilerleme ekseni:** para makine ve yükseltme alır, çevre puanı bölgeyi yeşertir.
- **Yeşillenme:** geri dönüştürülen her atık bölgeyi biraz daha canlandırır — çim ve gökyüzü rengi açılır, boş alanlarda tek tek ağaçlar filizlenir. HUD'daki çubuk bunu yüzde olarak gösterir.
- **Sıralı görev zinciri:** aynı anda tek aktif görev. HUD'da adı ve ilerlemesi yazar, dünyada sarı bir işaretçi nereye gidileceğini gösterir.

## Sıradaki hedefler

- Recycle noktalarını ileride tekrar malzeme tipine göre ayrıştırma
- Makineler arası gerçek üretim akışı (ayrıştır → presle → balya → sat)
- Çalışanlar ve otomasyon
- Görev zinciri ve yönlendirme

## Çalıştırma

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
