# Rheina Accuracy Backend — Udin‑Mol
API untuk **ambil keluaran 7 hari terakhir** dari banyak sumber per pasaran dan melakukan **majority voting** per tanggal untuk akurasi. Hasilnya siap dikonsumsi oleh **index_rheina_udinmol.html** (HTML 1 file).

## Endpoint
```
GET /api/fetch/:market?days=7
# :market ∈ {cambodia,toto-macau,sydney,china,japan,singapore,taiwan,hongkong}
```
Respon:
```json
{
  "market": "singapore",
  "name": "Singapura",
  "days": 7,
  "status": "ok 6/7",
  "sources_used": ["https://...","https://..."],
  "draws": [
    { "date": "14-08-2025", "n4d": "1234", "votes": [["1234",2],["5678",1]] },
    ...
  ],
  "bbfs6": ["1","2","3","4","5","6"],
  "bbfs5": ["1","2","3","4","5"],
  "cand4": ["1234","2345",...],
  "cand3": ["123","234",...],
  "cand2": ["12","23",...],
  "freq": [1,3,0,2,4,5,1,0,0,1]
}
```

## Deploy (Railway)
1. Buat repo GitHub, upload file proyek ini.
2. Buka [Railway](https://railway.app) → **New Project** → **Deploy from GitHub Repo**.
3. Railway otomatis detect Node + `start` script.
4. Setelah live, tes: `GET {BASE_URL}/health` dan `GET {BASE_URL}/api/fetch/singapore?days=7`.

## Kenapa akurat?
- Ambil dari **beberapa situs** per pasaran.
- **Majority vote**: angka yang paling banyak muncul untuk tanggal yang sama akan dipakai.
- **Exclude hari ini** (anggap belum keluar). Fokus 7 hari sebelumnya.
- Hanya menerima **4 digit** di sekitar tanggal yang tervalidasi.

> Catatan: daftar situs bisa berubah. Tambah/ubah di variabel `MARKETS` di `server.js`.
