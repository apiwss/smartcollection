// dataAllParser.js
window.dataAllParser = {
  parse: function (rawData) {
    const toTitleCase = (str) => {
      if (!str || str === "-") return "-";
      return str.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase()).join(" ");
    };

    const formatExcelDate = (val) => {
      if (val === null || val === undefined || String(val).trim() === "" || val === "-") return "-";
      const num = Number(val);
      if (!isNaN(num) && num > 30000 && num < 60000) {
        const date = new Date(Math.round((num - 25569) * 86400 * 1000));
        const d = String(date.getDate()).padStart(2, "0");
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
      }
      return String(val).trim();
    };

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

    const parseDatel = (raw) => {
      if (!raw) return "Priangan Timur";
      const str = String(raw).trim();
      const dashIdx = str.indexOf(" - ");
      if (dashIdx !== -1) return str.substring(dashIdx + 3).trim();
      return str;
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

    const parseCaringStatus = (rawStatus, rawPetugas, rawTgl) => {
      const s = String(rawStatus || "").trim();
      const p = String(rawPetugas || "").trim();
      const t = String(rawTgl || "").trim();

      const isStatusEmpty = !s || s === "-" || s === "" || s.toLowerCase() === "null";
      const isPetugasEmpty = !p || p === "-" || p === "" || p.toLowerCase() === "null";
      const isTglEmpty = !t || t === "-" || t === "" || t.toLowerCase() === "null";

      if (isStatusEmpty && isPetugasEmpty && isTglEmpty) {
        return "Belum Caring";
      }

      if (!isStatusEmpty) {
        const lowerS = s.toLowerCase();
        if (lowerS.includes("belum")) return "Belum Caring";
        if (lowerS.includes("janji")) return "Sudah Caring (Janji Bayar)";
        if (lowerS.includes("lunas")) return "Sudah Caring (Lunas)";
        if (lowerS.includes("tidak") || lowerS.includes("ts") || lowerS.includes("mailbox")) return "Sudah Caring (Tidak Tersambung)";
        if (lowerS.includes("menolak") || lowerS.includes("tolak")) return "Sudah Caring (Menolak Bayar)";
        if (lowerS.includes("komplen") || lowerS.includes("complain") || lowerS.includes("kendala")) return "Sudah Caring (Komplain)";
        if (lowerS === "sudah caring" || lowerS === "caring" || lowerS === "contacted") return "Sudah Caring";
        return `Sudah Caring (${s})`;
      }

      if (!isPetugasEmpty || !isTglEmpty) {
        // If status field is empty but officer or date is set, check if the officer is assigned as AR but no contact happened yet
        // If there is no status, we should treat it as Belum Caring because no actual call/contact occurred yet!
        return "Belum Caring";
      }

      return "Belum Caring";
    };

    const parseVisitStatus = (rawPetugas, rawTgl, rawHasil) => {
      const p = String(rawPetugas || "").trim();
      const t = String(rawTgl || "").trim();
      const h = String(rawHasil || "").trim();
      if ((!p || p === "-" || p === "") && (!t || t === "-" || t === "") && (!h || h === "-" || h === "")) {
        return "Belum Visit";
      }
      return "Sudah Visit";
    };

    const determineFinalStatus = (statusBayar, caringStatus, visitStatus, visitHasil, vocVisit) => {
      const sb = String(statusBayar || "").toUpperCase().trim();
      const vh = String(visitHasil || "").toLowerCase();
      const vv = String(vocVisit || "").toLowerCase();

      if (sb.includes("BELUM") || sb.includes("UNPAID")) {
        // Not lunas
      } else if (sb === "PAID" || sb.includes("LUNAS") || sb.includes("LNY") || sb === "LUNAS NYATA" || sb.includes("SUDAH")) {
        return "Lunas";
      }
      if (visitStatus === "Sudah Visit") {
        if (vh.includes("lunas") || vv.includes("lunas")) return "Lunas";
        if (vh.includes("janji") || vv.includes("janji")) return "Janji Bayar";
        return "Visit";
      }
      if (caringStatus !== "Belum Caring") {
        if (caringStatus.toLowerCase().includes("lunas")) return "Lunas";
        if (caringStatus.toLowerCase().includes("janji")) return "Janji Bayar";
        return "Sudah Caring";
      }
      return "Belum Caring";
    };

    return rawData.map((row, index) => {
      const rawId = getCol(row, "SND", "SND_GROUP", "NCLI");
      if (!rawId) return null;

      const serviceId = String(rawId).trim();
      const nama = String(getCol(row, "NAMA") || "Pelanggan Tanpa Nama").trim();
      const rawNoHp = getCol(row, "NO HP", "NO_HP", "NO_TELP", "TELP");
      const noHp = normalizePhoneNumber(rawNoHp);
      const tagihanRaw = getCol(row, "Tag_Total", "SALDO", "Tag_Inet");
      const tagihan = parseNum(tagihanRaw);
      const sto = String(getCol(row, "STO") || "-").trim();
      const datelRaw = getCol(row, "DATEL") || "";
      const witel = parseDatel(datelRaw);
      const regional = "Regional XI";
      const umurRaw = String(getCol(row, "UMUR_CUSTOMER") || "").trim();
      const umurTagihan = umurRaw || "Tidak Diketahui";
      const produk = String(getCol(row, "PRODUK") || "-").trim();
      const kategoriPelanggan = String(getCol(row, "KATEGORI PELANGGAN") || "-").trim();

      const rawPetugasCaring = getCol(row, "PETUGAS CARING", "PETUGAS");
      const petugasCaring = rawPetugasCaring ? toTitleCase(String(rawPetugasCaring).trim()) : "";
      const tglCaring = formatExcelDate(getCol(row, "TGL CARRING", "TGL CARING"));
      const statusCaringRaw = String(getCol(row, "STATUS CARING") || "").trim();
      const keteranganCaring = String(getCol(row, "KETERANGAN") || "-").trim();
      const vocCaring = String(getCol(row, "VOC") || "-").trim();

      const caringStatusFinal = parseCaringStatus(statusCaringRaw, petugasCaring, tglCaring);

      const caringObj = {
        status: caringStatusFinal,
        tanggal: tglCaring || "-",
        keterangan: keteranganCaring,
        janjiBayar: vocCaring !== "-" && vocCaring !== "" ? vocCaring : "-",
        petugas: petugasCaring || "-",
        reasonCall: "-",
        obstacle: "-"
      };

      const rawPetugasVisit = getCol(row, "PETUGAS VISIT");
      const petugasVisit = rawPetugasVisit ? toTitleCase(String(rawPetugasVisit).trim()) : "";
      const tglVisit = formatExcelDate(getCol(row, "TANGGAL VISIT"));
      const hasilVisit = String(getCol(row, "HASIL VISIT") || "-").trim();
      const vocVisit2 = String(getCol(row, "VOC VISIT2") || "-").trim();

      const visitStatusFinal = parseVisitStatus(petugasVisit, tglVisit, hasilVisit);

      const visitObj = {
        status: visitStatusFinal,
        tanggal: tglVisit || "-",
        hasil: hasilVisit || "-",
        petugas: petugasVisit || "-"
      };

      // Cek PAID_L11 untuk status pembayaran (Prioritas utama)
      const rawPaidL11 = getCol(row, "PAID_L11");
      const hasPaidL11 = (rawPaidL11 !== null && rawPaidL11 !== undefined && String(rawPaidL11).trim() !== "");
      
      let statusBayar = "";
      let finalStatus = "";
      
      if (hasPaidL11) {
        const valPaidL11 = String(rawPaidL11).trim().toUpperCase();
        if (valPaidL11 === "PAID") {
          statusBayar = "PAID";
          finalStatus = "Lunas";
        } else {
          statusBayar = "UNPAID";
          // Jika UNPAID, tentukan finalStatus berdasarkan aktivitas caring/visit (tetapi TIDAK BOLEH Lunas!)
          const baseStatus = determineFinalStatus("UNPAID", caringStatusFinal, visitStatusFinal, hasilVisit, vocVisit2);
          finalStatus = baseStatus === "Lunas" ? "Belum Caring" : baseStatus;
        }
      } else {
        // Fallback ke logika lama
        statusBayar = String(getCol(row, "STATUS BAYAR") || "").trim();
        finalStatus = determineFinalStatus(statusBayar, caringStatusFinal, visitStatusFinal, hasilVisit, vocVisit2);
      }

      const tglBayar = formatExcelDate(getCol(row, "TANGGAL BAYAR"));
      const jumlahBayar = parseNum(getCol(row, "JUMLAH BAYAR"));
      const billingKe = String(getCol(row, "Billing Ke -") || "").trim();

      return {
        id: serviceId,
        nama: nama,
        accountName: nama,
        noHp: noHp,
        tagihan: tagihan,
        regional: regional,
        witel: witel,
        sto: sto,
        datel: datelRaw,
        status: finalStatus,
        periode: "Juni 2026",
        umurTagihan: umurTagihan,
        produk: produk,
        kategori: kategoriPelanggan,
        statusBayar: statusBayar,
        tglBayar: tglBayar,
        jumlahBayar: jumlahBayar,
        billingKe: billingKe,
        caring: caringObj,
        visit: visitObj,
        whatsappStatus: "Belum WA",
        datasetType: "Data All"
      };
    }).filter(c => c !== null);
  }
};
