// c3mrParser.js
window.c3mrParser = {
  parse: function (rawData) {
    const parseNum = (val) => {
      if (val === null || val === undefined) return 0;
      const cleaned = String(val).replace(/[^0-9.]/g, "");
      return parseFloat(cleaned) || 0;
    };

    const normalizePhoneNumber = (raw) => {
      if (raw === null || raw === undefined) return "Tidak tersedia";
      let str = String(raw).trim();
      if (str === "" || str === "-" || str.toLowerCase() === "null") return "Tidak tersedia";
      
      const parts = str.split(/[,/;|]/);
      let firstPart = parts[0].trim();
      if (!firstPart) return "Tidak tersedia";
      
      let cleaned = firstPart.replace(/[\s\-\.\(\)]/g, "");
      cleaned = cleaned.replace(/[^0-9+]/g, "");
      
      if (!cleaned || cleaned === "+") return "Tidak tersedia";
      return cleaned;
    };

    const getCol = (row, ...candidates) => {
      const normalize = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      const normalizedCandidates = candidates.map(normalize);
      
      for (const key of Object.keys(row)) {
        if (normalizedCandidates.includes(normalize(key))) {
          const val = row[key];
          if (val !== undefined && val !== null && String(val).trim() !== "") {
            return val;
          }
        }
      }
      return null;
    };

    const parseCaringStatus = (statusObc) => {
      const s = String(statusObc || "").trim().toLowerCase();
      if (s === "" || s === "-" || s.includes("belum") || s === "null") {
        return "Belum Caring";
      }
      if (s.includes("not contacted") || s.includes("tidak tersambung") || s.includes("ts")) {
        return "Not Contacted";
      }
      if (s.includes("contacted") || s.includes("tersambung") || s.includes("sukses") || s.includes("berhasil")) {
        return "Contacted";
      }
      // Capitalize first letter of other values
      return statusObc.charAt(0).toUpperCase() + statusObc.slice(1);
    };

    const parseWhatsappStatus = (waStatus) => {
      const ws = String(waStatus || "").trim().toLowerCase();
      if (ws === "" || ws === "-" || ws.includes("belum") || ws === "null") {
        return "Belum WA";
      }
      if (ws.includes("gagal") || ws.includes("fail") || ws.includes("invalid") || ws.includes("reject")) {
        return "Gagal WA";
      }
      if (ws.includes("berhasil") || ws.includes("sukses") || ws.includes("success") || ws.includes("send") || ws.includes("sent")) {
        return "Berhasil WA";
      }
      return "Berhasil WA";
    };

    const parseReasonCall = (reason) => {
      const r = String(reason || "").trim().toLowerCase();
      if (r === "" || r === "-" || r === "null") return "-";
      if (r.includes("kosong") || r.includes("rumah")) return "Rumah kosong";
      if (r.includes("tidak aktif") || r.includes("non aktif") || r.includes("mati")) return "Nomor tidak aktif";
      if (r.includes("tidak diangkat") || r.includes("no answer") || r.includes("rna")) return "Tidak diangkat";
      if (r.includes("salah nomor") || r.includes("salah no") || r.includes("wrong number")) return "Salah nomor";
      if (r.includes("menolak") || r.includes("reject") || r.includes("tolak")) return "Menolak";
      if (r.includes("janji") || r.includes("promis") || r.includes("pbm")) return "Janji bayar";
      return "Lainnya";
    };

    const determineFinalStatus = (paymentStatus, caringStatus) => {
      const ps = String(paymentStatus || "").toUpperCase().trim();
      if (ps.includes("BELUM") || ps.includes("UNPAID")) {
        // Not lunas
      } else if (ps === "PAID" || ps.includes("LUNAS") || ps.includes("LNY") || ps === "LUNAS NYATA" || ps.includes("SUDAH")) {
        return "Lunas";
      }
      if (caringStatus === "Contacted") {
        return "Sudah Caring";
      }
      if (caringStatus === "Not Contacted") {
        return "Sudah Caring";
      }
      return "Belum Caring";
    };

    return rawData.map((row, index) => {
      // C3MR identifier priority: SND, then SND_GROUP
      const rawId = getCol(row, "SND", "SND_GROUP");
      if (!rawId) return null;
      const serviceId = String(rawId).trim();

      // Nama / NAMA_NCLI
      const nama = String(getCol(row, "NAMA", "NAMA_NCLI") || "Pelanggan Tanpa Nama").trim();
      const accountName = String(getCol(row, "NAMA_NCLI", "NAMA") || nama).trim();
      
      // Alamat
      const alamat = String(getCol(row, "ALAMAT") || "-").trim();

      // Nomor Telepon Logic
      const rawUpdateTelp = getCol(row, "UPDATE_TELP");
      const rawTelp = getCol(row, "TELP", "NO HP");
      
      const normUpdate = normalizePhoneNumber(rawUpdateTelp);
      const normTelp = normalizePhoneNumber(rawTelp);
      
      const noHp = (normUpdate !== "Tidak tersedia") ? normUpdate : normTelp;

      // Witel & STO & Datel
      const witel = String(getCol(row, "WITEL") || "Priangan Timur").trim();
      const sto = String(getCol(row, "STO_DESC", "STO") || "-").trim();
      const datel = String(getCol(row, "DATEL") || "-").trim();
      
      // Produk
      const produk = String(getCol(row, "PRODUK") || "-").trim();

      // Tagihan & Saldo
      const billAmount = parseNum(getCol(row, "BILL_AMOUNT"));
      const saldo = parseNum(getCol(row, "SALDO"));
      const tagihan = saldo > 0 ? saldo : billAmount;

      // Status Caring OBC
      const statusObc = String(getCol(row, "STATUS_OBC") || "").trim();
      const caringStatusFinal = parseCaringStatus(statusObc);
      const caringOfficer = String(getCol(row, "PETUGAS CEK", "PETUGAS") || "-").trim();
      const reasonCall = parseReasonCall(getCol(row, "REASON_CALL"));
      const obstacle = String(getCol(row, "KENDALA") || "-").trim();
      const notes = String(getCol(row, "KETERANGAN") || "-").trim();

      const caringObj = {
        status: caringStatusFinal,
        tanggal: "-",
        keterangan: notes,
        janjiBayar: reasonCall === "Janji bayar" ? "PBM Janji Bayar" : "-",
        petugas: caringOfficer,
        reasonCall: reasonCall,
        obstacle: obstacle
      };

      // WhatsApp Status
      const rawWa = getCol(row, "STATUS_WA");
      const whatsappStatus = parseWhatsappStatus(rawWa);

      // Visit Status (C3MR doesn't have native visit columns)
      const visitObj = {
        status: "Belum Visit",
        tanggal: "-",
        hasil: "-",
        petugas: "-"
      };

      // Status Bayar
      const statusBayar = String(getCol(row, "STATUS_BAYAR") || "UNPAID").trim();
      const finalStatus = determineFinalStatus(statusBayar, caringStatusFinal);

      // Umur Tagihan (Derive from billAmount / outstanding context if needed)
      // Since C3MR doesn't have UMUR_CUSTOMER column, check if there's a column, or default
      const umurRaw = String(getCol(row, "UMUR_CUSTOMER") || "").trim();
      const umurTagihan = umurRaw || "Tidak Diketahui";

      return {
        id: serviceId,
        nama: nama,
        accountName: accountName,
        alamat: alamat,
        noHp: noHp,
        tagihan: tagihan,
        regional: "Regional XI",
        witel: witel,
        sto: sto,
        datel: datel,
        status: finalStatus,
        periode: "Juni 2026",
        umurTagihan: umurTagihan,
        produk: produk,
        kategori: "-",
        statusBayar: statusBayar,
        tglBayar: "-",
        jumlahBayar: 0,
        billingKe: "1",
        caring: caringObj,
        visit: visitObj,
        whatsappStatus: whatsappStatus,
        datasetType: "C3MR Unpaid"
      };
    }).filter(c => c !== null);
  }
};
