# Recycle Factory

Mobil dikey ekranda oynanan, Three.js tabanlı low-poly bir işletme ve otomasyon oyunu.

Oyuncu küçük ve kirli bir geri dönüşüm alanında sokaktan atık toplayarak başlar. Zamanla vatandaş teslimatları, çöp kamyonları, çalışanlar, yeni makineler ve otomatik üretim hatları açılır. Ana hedef; manuel çalışan küçük alanı, canlı ve büyük bir geri dönüşüm tesisine dönüştürmektir.

## Oynanabilir test sürümü

En güncel geliştirme sürümü her `main` veya `feat/**` güncellemesinde GitHub Pages'e otomatik dağıtılır:

https://eraybek.github.io/recycle-factory/

## Temel oyun döngüsü

1. Sokaktan karışık atık topla.
2. Atıkları tesiste ayrıştır.
3. Plastik ve metali makinelerde işle.
4. İşlenmiş ürünleri satış alanına taşı.
5. Para kazanıp makine, çalışan ve yeni alan aç.
6. Üretim zincirini otomatikleştir.

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

## İlk dikey dilim

İlk oynanabilir sürüm aşağıdakileri hedefler:

- Low-poly sokak ve tesis alanı
- Oyuncu hareketi ve takip kamerası
- Mobil joystick ve klavye test kontrolü
- Sokakta plastik ve metal atık toplama
- Sınırlı taşıma kapasitesi
- Tesiste ayırma ve iki ayrı stok alanı
- Basit pres makinesi döngüsü
- İşlenmiş ürünü satış alanına taşıma
- Para ve satın alma alanı

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
