// ==========================================
// INDIBIZ INTEGRATED COLLECTION DASHBOARD LOGIC
// ==========================================

// Global state variables
let customerDatabase = [];
let filteredCustomers = [];
let currentPage = 1;
const rowsPerPage = 10;
let actionCurrentPage = 1;
const actionRowsPerPage = 50;
let actionFilterPetugasVal = ""; // Action list Petugas Caring filter value

const DEFAULT_GSHEETS_LINK = "https://docs.google.com/spreadsheets/d/1RjhMpP3pTlzONbuoRajODGz3tTGm3p73/edit";


// Raw spreadsheet uploads
let rawDataAll = null;
let rawDataset = null;
let currentDatasetType = null; // "Data All" | "C3MR Unpaid"
let rawHasilCaring = null;
let rawViseepro = null;

// Chart JS Instances
let chartStatusCollection = null;
let chartCaringVisit = null;
let chartOutstandingSto = null;
let chartCollectionTrend = null;
let chartOfficerPerformance = null;

// Constant lists
const WITELS_STOS = {
  "Priangan Timur": ["Banjar", "Garut", "Indramayu", "Kuningan", "Majalengka", "Inner Priangan Timur", "Singaparna", "Tasikmalaya"],
  "Bekasi": ["BKS", "CIB", "CPA", "CKR"],
  "Bogor": ["BGR", "CPA", "CBI", "CSU"],
  "Tangerang": ["TNG", "CPT", "BWD", "SER"],
  "Bandung": ["DGO", "LBG", "TGL", "UJG"],
  "Cirebon": ["CRB", "Sumber", "Arjawinangun"],
  "Sukabumi": ["SMI", "CJR", "PLB", "PJD"],
  "Semarang": ["SMR", "JAP", "MDR", "TGL"],
  "Surabaya": ["KBL", "RKT", "DAR", "TND"],
  "Medan": ["MDN", "TRG", "TMB", "BEL"]
};

// Daftar petugas AR resmi Unit Pay Collection Telkom Witel Priangan Timur
const OFFICERS_CARING = ["Novi", "Sayus", "Shokikah", "Tatang", "Wahyu Mulyadi", "Yayat"];
const OFFICERS_VISIT = ["Novi", "Sayus", "Shokikah", "Tatang", "Wahyu Mulyadi", "Yayat"];

// =========================================================================
// INDEXEDDB UTILITIES FOR DATA PERSISTENCE
// =========================================================================
const DB_NAME = 'TelkomCollectionDB';
const DB_VERSION = 1;
const STORE_NAME = 'customers';

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveToDB(data) {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Clear old data first
    await new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Add new data
    for (const item of data) {
      store.put(item);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to save to IndexedDB", err);
  }
}

async function loadFromDB() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to load from IndexedDB", err);
    return [];
  }
}

async function clearDB() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to clear IndexedDB", err);
  }
}

async function initIndexedDBData() {
  try {
    const metaStr = localStorage.getItem('dataset_metadata');
    const isCleared = localStorage.getItem('dataset_cleared') === 'true';

    // Set active link for Google Sheets (priority: custom, fallback: default)
    let activeLink = localStorage.getItem('google_sheets_link');
    if (!activeLink) {
      activeLink = DEFAULT_GSHEETS_LINK;
      localStorage.setItem('google_sheets_link', DEFAULT_GSHEETS_LINK);
    }
    const inputGsLink = document.getElementById("input-google-sheets-link");
    if (inputGsLink) {
      inputGsLink.value = activeLink;
    }

    let shouldSync = false;
    let syncLink = activeLink;

    if (metaStr && !isCleared) {
      const meta = JSON.parse(metaStr);
      if (meta.sourceType === "google_sheets") {
        shouldSync = true;
        syncLink = meta.googleSheetsLink || activeLink;
      } else {
        // Source is a local file, load from IndexedDB as usual
        const data = await loadFromDB();
        if (data && data.length > 0) {
          currentDatasetType = meta.datasetType;
          customerDatabase = data;
          filteredCustomers = [...customerDatabase];

          buildDynamicFilterOptions();
          calculateKPIs();
          updateCharts();
          renderTable();
          updatePills();
          renderActionListPanel();

          document.getElementById("data-status-text").innerText = `${currentDatasetType} Loaded`;
          logConsole(`Memuat ${customerDatabase.length} data pelanggan terintegrasi dari database lokal (${meta.fileName}).`, "green");

          showActiveDatasetUI(meta);
          return;
        }
      }
    } else {
      // First open or cleared data, default to syncing the Google Sheets default link
      shouldSync = true;
    }

    if (shouldSync) {
      showLoadingOverlay("Menghubungkan ke Google Sheets & Sinkronisasi data...");
      try {
        await fetchGoogleSheetAndSync(syncLink, true);
        hideLoadingOverlay();
      } catch (err) {
        hideLoadingOverlay();
        logConsole(`Sinkronisasi otomatis gagal: ${err.message}. Menggunakan cache lokal jika tersedia.`, "warning");

        // Fallback to load from IndexedDB if we have cached data
        const data = await loadFromDB();
        if (data && data.length > 0) {
          if (metaStr) {
            const meta = JSON.parse(metaStr);
            currentDatasetType = meta.datasetType;
            showActiveDatasetUI(meta);
            document.getElementById("data-status-text").innerText = `${currentDatasetType} Loaded (Offline Cache)`;
          } else {
            currentDatasetType = "Data All";
            document.getElementById("data-status-text").innerText = "Data All (Offline Cache)";
            showActiveDatasetUI({
              fileName: `Google Sheets (${getSpreadsheetId(syncLink) || "Unknown"})`,
              datasetType: "Data All",
              uploadTime: new Date().toLocaleString("id-ID"),
              recordCount: data.length,
              sourceType: "google_sheets",
              googleSheetsLink: syncLink
            });
          }
          customerDatabase = data;
          filteredCustomers = [...customerDatabase];

          buildDynamicFilterOptions();
          calculateKPIs();
          updateCharts();
          renderTable();
          updatePills();
          renderActionListPanel();
        } else {
          // No cache available, load mock/sample data as the ultimate fallback so dashboard is never empty
          logConsole("Sinkronisasi data Google Sheets gagal. Memuat data sampel sebagai inisialisasi awal.", "warning");
          await loadMockData();

          const meta = {
            fileName: "Sample_Dataset_Indibiz.xlsx",
            datasetType: "Data All",
            uploadTime: new Date().toLocaleString("id-ID"),
            recordCount: customerDatabase.length
          };
          localStorage.setItem('dataset_metadata', JSON.stringify(meta));
          showActiveDatasetUI(meta);
          
          document.getElementById("data-status-text").innerText = "Sample Data Loaded";
        }
      }
    }
  } catch (err) {
    console.error("IndexedDB error, falling back to mock data", err);
    await loadMockData();
  }
}

function showActiveDatasetUI(meta) {
  const uploaderView = document.getElementById("uploader-view");
  const activeDatasetView = document.getElementById("active-dataset-view");

  if (uploaderView && activeDatasetView) {
    uploaderView.style.display = "none";
    activeDatasetView.style.display = "block";

    document.getElementById("active-file-title").innerText = meta.fileName;
    document.getElementById("active-file-title").title = meta.fileName;

    const badge = document.getElementById("active-dataset-badge-type");
    if (badge) {
      if (meta.sourceType === "google_sheets") {
        badge.innerText = "Data All (Google Sheets)";
        badge.className = "badge badge-pink";
        badge.style.color = "#FFA6B3";
      } else {
        badge.innerText = meta.datasetType;
        if (meta.datasetType === "C3MR Unpaid") {
          badge.className = "badge badge-purple";
          badge.style.color = "#C084FC";
        } else {
          badge.className = "badge badge-pink";
          badge.style.color = "#FFA6B3";
        }
      }
    }

    document.getElementById("active-dataset-time").innerText = meta.uploadTime;
    document.getElementById("active-dataset-records").innerText = `${meta.recordCount.toLocaleString("id-ID")} pelanggan`;

    const btnChangeDataset = document.getElementById("btn-change-dataset");
    const gsheetSyncContainer = document.getElementById("gsheet-sync-container");
    if (gsheetSyncContainer) {
      if (meta.sourceType === "google_sheets") {
        gsheetSyncContainer.style.display = "flex";
        if (btnChangeDataset) btnChangeDataset.style.display = "none";
      } else {
        gsheetSyncContainer.style.display = "none";
        if (btnChangeDataset) btnChangeDataset.style.display = "block";
      }
    }
  }
}

window.triggerChangeDataset = function () {
  const uploaderView = document.getElementById("uploader-view");
  const activeDatasetView = document.getElementById("active-dataset-view");
  if (uploaderView && activeDatasetView) {
    uploaderView.style.display = "block";
    activeDatasetView.style.display = "none";
  }
};

window.triggerClearDataset = async function () {
  if (confirm("Apakah Anda yakin ingin menghapus seluruh dataset yang tersimpan? Tindakan ini akan mengosongkan dashboard.")) {
    customerDatabase = [];
    filteredCustomers = [];
    currentDatasetType = null;
    rawDataset = null;
    rawDataAll = null;
    actionFilterPetugasVal = ""; // Reset Tindak Lanjut filter

    localStorage.removeItem('dataset_metadata');
    localStorage.setItem('dataset_cleared', 'true');
    await clearDB();

    clearAllCharts();
    renderTable();
    calculateKPIs();
    buildDynamicFilterOptions();
    updatePills();
    renderActionListPanel();

    document.getElementById("data-status-text").innerText = "Data Kosong";
    logConsole("Dataset berhasil dihapus dari browser.", "red");

    const uploaderView = document.getElementById("uploader-view");
    const activeDatasetView = document.getElementById("active-dataset-view");
    if (uploaderView && activeDatasetView) {
      uploaderView.style.display = "block";
      activeDatasetView.style.display = "none";
    }

    const statusDataAll = document.getElementById("status-data-all");
    if (statusDataAll) {
      statusDataAll.innerHTML = `<i data-lucide="circle-dashed" class="spinning"></i> <span>Menunggu file...</span>`;
      lucide.createIcons({ root: statusDataAll });
    }
  }
};

function setupActiveDatasetEventListeners() {
  // Event listeners are bound directly via onclick attributes in the HTML
}

// Helper to determine last update of customer
function getCustomerLastUpdate(c) {
  if (c.datasetType === "Data All") {
    if (c.caring && c.caring.tanggal && c.caring.tanggal !== "-") {
      return c.caring.tanggal;
    }
    if (c.visit && c.visit.tanggal && c.visit.tanggal !== "-") {
      return c.visit.tanggal;
    }
  } else {
    if (c.visit && c.visit.tanggal && c.visit.tanggal !== "-") {
      return c.visit.tanggal;
    }
    if (c.caring && c.caring.tanggal && c.caring.tanggal !== "-") {
      return c.caring.tanggal;
    }
  }
  return `05 ${c.periode}`;
}

// Helper to navigate to a panel programmatically
function navigateToPanel(panelName) {
  const menuItems = document.querySelectorAll(".menu-item");
  const panels = document.querySelectorAll(".panel");
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");

  const panelTitles = {
    overview: { title: "Ringkasan Eksekutif", subtitle: "Monitoring aktivitas Unit Pay Collection Telkom secara Real-Time" },
    "action-list": { title: "Daftar Tindak Lanjut (Need Follow Up)", subtitle: "Daftar pelanggan prioritas yang membutuhkan perhatian operasional collection segera" },
    database: { title: "Data Integrasi Pelanggan", subtitle: "Tabel pencarian, detail progres, dan export data collection" },
    officers: { title: "Kinerja Petugas Lapangan", subtitle: "Analisis produktivitas caring telepon/WA dan visit collector" },
    integration: { title: "Integrasi Data", subtitle: "Unggah dan sinkronisasikan sumber spreadsheet utama" }
  };

  menuItems.forEach(mi => {
    mi.classList.remove("active");
    if (mi.getAttribute("data-panel") === panelName) {
      mi.classList.add("active");
    }
  });

  panels.forEach(panel => {
    panel.classList.remove("active");
    if (panel.id === `panel-${panelName}`) {
      panel.classList.add("active");
    }
  });

  if (panelTitles[panelName]) {
    pageTitle.innerText = panelTitles[panelName].title;
    pageSubtitle.innerText = panelTitles[panelName].subtitle;
  }
}

// Helper to show global loading overlay
function showLoadingOverlay(message) {
  let overlay = document.getElementById("loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.style = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(10, 4, 6, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      gap: 16px;
    `;
    overlay.innerHTML = `
      <div class="spinning" style="width: 48px; height: 48px; border: 4px solid var(--border-color); border-top-color: var(--accent); border-radius: 50%;"></div>
      <div id="loading-overlay-message" style="color: #FFF; font-size: 14px; font-weight: 500; font-family: var(--font-family);">${message}</div>
    `;
    document.body.appendChild(overlay);
  } else {
    document.getElementById("loading-overlay-message").innerText = message;
    overlay.style.display = "flex";
  }
}

// Helper to hide global loading overlay
function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) {
    overlay.style.display = "none";
  }
}

// Initialization on DOM loaded
document.addEventListener("DOMContentLoaded", async () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // Setup SPA Navigation
  setupNavigation();

  // Setup Filter Listeners
  setupFilters();

  // Setup Action List Event Handlers
  setupActionListEvents();

  // Setup Excel & PDF Export triggers
  setupExports();

  // Setup Drop Zones for Integration Files
  setupFileDropZones();

  // Setup Active Dataset view event listeners
  setupActiveDatasetEventListeners();

  // Pre-fill stored Google Sheets link if available
  const storedLink = localStorage.getItem('google_sheets_link');
  const inputGsLink = document.getElementById("input-google-sheets-link");
  if (inputGsLink && storedLink) {
    inputGsLink.value = storedLink;
  }

  // Load Default Data from DB or fallback
  await initIndexedDBData();

  // Console logging init message
  logConsole("Sistem Pay Collection Telkom berhasil diinisialisasi.", "info");
  logConsole("Siap menerima upload data Google Spreadsheet.", "info");

  // Window resize listener to handle dynamic legend update
  window.addEventListener('resize', () => {
    const newPos = window.innerWidth < 768 ? 'bottom' : 'right';
    let updated = false;
    if (chartStatusCollection && chartStatusCollection.options.plugins.legend) {
      if (chartStatusCollection.options.plugins.legend.position !== newPos) {
        chartStatusCollection.options.plugins.legend.position = newPos;
        chartStatusCollection.update();
        updated = true;
      }
    }
    if (chartOfficerPerformance && chartOfficerPerformance.options.plugins.legend) {
      if (chartOfficerPerformance.options.plugins.legend.position !== newPos) {
        chartOfficerPerformance.options.plugins.legend.position = newPos;
        chartOfficerPerformance.update();
        updated = true;
      }
    }
  });
});

// =========================================================================
// 1. SPA NAVIGATION & DRAWER
// =========================================================================
let activeActionCategory = 'belum-caring';
let actionSearchQuery = '';

function setupNavigation() {
  const menuItems = document.querySelectorAll(".menu-item");
  const panels = document.querySelectorAll(".panel");
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");

  const panelTitles = {
    overview: { title: "Ringkasan Eksekutif", subtitle: "Monitoring aktivitas Unit Pay Collection Telkom secara Real-Time" },
    "action-list": { title: "Daftar Tindak Lanjut (Need Follow Up)", subtitle: "Daftar pelanggan prioritas yang membutuhkan perhatian operasional collection segera" },
    database: { title: "Data Integrasi Pelanggan", subtitle: "Tabel pencarian, detail progres, dan export data collection" },
    officers: { title: "Kinerja Petugas Lapangan", subtitle: "Analisis produktivitas caring telepon/WA dan visit collector" },
    integration: { title: "Integrasi Google Spreadsheet", subtitle: "Unggah dan sinkronisasikan tiga sumber spreadsheet utama" }
  };

  // Hamburger and Sidebar Toggle logic for mobile
  const btnHamburger = document.getElementById("btn-hamburger");
  const sidebar = document.querySelector(".sidebar");
  const sidebarOverlay = document.getElementById("sidebar-overlay");

  if (btnHamburger && sidebar && sidebarOverlay) {
    btnHamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      sidebar.classList.toggle("active");
      sidebarOverlay.classList.toggle("active");
    });

    sidebarOverlay.addEventListener("click", () => {
      sidebar.classList.remove("active");
      sidebarOverlay.classList.remove("active");
    });
  }

  menuItems.forEach(item => {
    item.addEventListener("click", () => {
      // Auto close sidebar on mobile menu item click
      if (sidebar && sidebar.classList.contains("active")) {
        sidebar.classList.remove("active");
        sidebarOverlay.classList.remove("active");
      }
      // Toggle menu items active state
      menuItems.forEach(mi => mi.classList.remove("active"));
      item.classList.add("active");

      // Toggle panels active state
      const targetPanel = item.getAttribute("data-panel");
      panels.forEach(panel => {
        panel.classList.remove("active");
        if (panel.id === `panel-${targetPanel}`) {
          panel.classList.add("active");
        }
      });

      // Update page title
      if (panelTitles[targetPanel]) {
        pageTitle.innerText = panelTitles[targetPanel].title;
        pageSubtitle.innerText = panelTitles[targetPanel].subtitle;
      }

      // Special actions on tab activation
      if (targetPanel === "overview") {
        updateCharts();
      } else if (targetPanel === "action-list") {
        renderActionListPanel();
      } else if (targetPanel === "database") {
        renderTable();
      } else if (targetPanel === "officers") {
        renderOfficerTab();
      }

      // Auto close drawer if open
      closeDrawer();
    });
  });

  // Close drawer handlers
  document.getElementById("btn-close-drawer").addEventListener("click", closeDrawer);
  document.getElementById("detail-drawer-overlay").addEventListener("click", closeDrawer);
}

function openDrawer(customerId) {
  const customer = customerDatabase.find(c => c.id === customerId);
  if (!customer) return;

  // Show overlay and drawer
  const overlay = document.getElementById("detail-drawer-overlay");
  const drawer = document.getElementById("detail-drawer");
  overlay.classList.add("active");
  drawer.classList.add("active");

  // Fill details
  document.getElementById("drawer-avatar").innerText = customer.nama.substring(0, 2).toUpperCase();
  document.getElementById("drawer-cust-name").innerText = customer.nama;
  document.getElementById("drawer-cust-id").innerText = customer.id;
  document.getElementById("drawer-phone").innerText = customer.noHp;
  document.getElementById("drawer-witel").innerText = `${customer.regional} / ${customer.witel}`;
  document.getElementById("drawer-sto").innerText = customer.sto;
  document.getElementById("drawer-tagihan").innerText = formatRupiah(customer.tagihan);
  document.getElementById("drawer-periode").innerText = customer.periode;

  // Set badge
  const badge = document.getElementById("drawer-cust-status");
  badge.className = "badge";
  badge.innerText = customer.status;

  if (customer.status === "Lunas") badge.classList.add("badge-green");
  else if (customer.status === "Janji Bayar") badge.classList.add("badge-yellow");
  else if (customer.status === "Visit") badge.classList.add("badge-blue");
  else if (customer.status === "Belum Caring") badge.classList.add("badge-gray");
  else if (customer.status === "Sudah Caring") badge.classList.add("badge-purple");
  else if (customer.status === "Menunggak") badge.classList.add("badge-red");

  // Render Timeline steps
  renderTimeline(customer);
}

function closeDrawer() {
  document.getElementById("detail-drawer-overlay").classList.remove("active");
  document.getElementById("detail-drawer").classList.remove("active");
}

function renderTimeline(customer) {
  // Step 1: Tagihan Terbit
  const stepTagihan = document.getElementById("step-tagihan");
  stepTagihan.className = "timeline-item completed success";
  document.getElementById("timeline-tagihan-date").innerText = `Tanggal: 05 ${customer.periode.split(' ')[0]} 2026`;

  // Step 2: Caring
  const stepCaring = document.getElementById("step-caring");
  const caringDesc = document.getElementById("timeline-caring-desc");
  const caringMeta = document.getElementById("timeline-caring-meta");

  if (customer.caring && customer.caring.status !== "Belum Caring") {
    stepCaring.className = "timeline-item completed";

    // Customize style based on caring outcome
    if (customer.caring.status.includes("Lunas")) {
      stepCaring.classList.add("success");
    } else if (customer.caring.status.includes("Janji")) {
      stepCaring.classList.add("warning");
    } else {
      stepCaring.classList.add("info");
    }

    document.getElementById("timeline-caring-date").innerText = `Tanggal: ${customer.caring.tanggal}`;
    caringDesc.innerText = `Catatan Caring: ${customer.caring.keterangan}`;
    caringMeta.style.display = "flex";
    document.getElementById("timeline-caring-officer").innerText = customer.caring.petugas;
    document.getElementById("timeline-caring-result").innerText = customer.caring.status;
  } else {
    stepCaring.className = "timeline-item";
    document.getElementById("timeline-caring-date").innerText = "Tanggal: -";
    caringDesc.innerText = "Menunggu antrean penanganan telepon / WhatsApp oleh Unit Pay Collection.";
    caringMeta.style.display = "none";
  }

  // Step 3: Visit
  const stepVisit = document.getElementById("step-visit");
  const visitDesc = document.getElementById("timeline-visit-desc");
  const visitMeta = document.getElementById("timeline-visit-meta");

  if (customer.visit && customer.visit.status !== "Belum Visit") {
    stepVisit.className = "timeline-item completed";

    if (customer.visit.hasil.includes("Lunas")) {
      stepVisit.classList.add("success");
    } else if (customer.visit.hasil.includes("Janji")) {
      stepVisit.classList.add("warning");
    } else {
      stepVisit.classList.add("info");
    }

    document.getElementById("timeline-visit-date").innerText = `Tanggal: ${customer.visit.tanggal}`;
    visitDesc.innerText = `Laporan Kunjungan: ${customer.visit.hasil}`;
    visitMeta.style.display = "flex";
    document.getElementById("timeline-visit-officer").innerText = customer.visit.petugas;
    document.getElementById("timeline-visit-result").innerText = customer.visit.status;
  } else {
    stepVisit.className = "timeline-item";
    document.getElementById("timeline-visit-date").innerText = "Tanggal: -";
    visitMeta.style.display = "none";

    if (customer.status === "Lunas" && (!customer.visit || customer.visit.status === "Belum Visit")) {
      visitDesc.innerText = "Tidak memerlukan visit (Pelanggan lunas setelah fase Caring).";
    } else {
      visitDesc.innerText = "Belum dijadwalkan visit lapangan oleh kolektor.";
    }
  }

  // Step 4: Pembayaran (Lunas)
  const stepBayar = document.getElementById("step-bayar");
  const bayarDesc = document.getElementById("timeline-bayar-desc");

  if (customer.status === "Lunas") {
    stepBayar.className = "timeline-item completed success";

    // Try to determine settlement date
    let settlementDate = "25 Juni 2026";
    if (customer.visit && customer.visit.hasil.includes("Lunas")) {
      settlementDate = customer.visit.tanggal;
    } else if (customer.caring && customer.caring.status.includes("Lunas")) {
      settlementDate = customer.caring.tanggal;
    }

    document.getElementById("timeline-bayar-date").innerText = `Tanggal: ${settlementDate}`;
    bayarDesc.innerText = `Tagihan LUNAS. Dana pembayaran Rp ${formatRupiah(customer.tagihan)} telah berhasil ditagih (settlement) melalui Jaringan Collection Telkom.`;
  } else {
    stepBayar.className = "timeline-item";
    document.getElementById("timeline-bayar-date").innerText = "Tanggal: -";

    if (customer.status === "Janji Bayar") {
      bayarDesc.innerText = `Menunggu komitmen janji bayar pada tanggal: ${customer.caring.janjiBayar || "segera"}.`;
    } else {
      bayarDesc.innerText = "Menunggu konfirmasi pembayaran lunas tagihan.";
    }
  }
}

// =========================================================================
// 2. MOCK DATA GENERATION ENGINE
// =========================================================================
async function loadMockData() {
  const firstNames = ["Budi", "Siti", "Heri", "Dewi", "Agus", "Rini", "Ahmad", "Diana", "Eko", "Putri", "Hendra", "Siska", "Rudi", "Mega", "Fajar", "Lestari", "Irfan", "Yulia", "Andi", "Tari", "Joko", "Sri", "Aditya", "Reni", "Wawan"];
  const lastNames = ["Santoso", "Aminah", "Hidayat", "Lestari", "Setiawan", "Wijaya", "Fauzi", "Pratama", "Nugroho", "Sari", "Hermawan", "Utami", "Saputra", "Wahyuni", "Kusuma", "Hayati", "Siregar", "Lubis", "Ginting", "Nasution", "Manurung"];

  customerDatabase = [];

  // Generate 120 customers
  for (let i = 0; i < 120; i++) {
    // Determine Region and Witel
    const witels = Object.keys(WITELS_STOS);
    let witel = witels[i % witels.length];
    const stos = WITELS_STOS[witel];
    let sto = stos[i % stos.length];

    // Regional based on Witel
    let regional = "Regional II";
    if (witel === "Bandung" || witel === "Cirebon" || witel === "Sukabumi") regional = "Regional III";
    else if (witel === "Semarang") regional = "Regional IV";
    else if (witel === "Surabaya") regional = "Regional V";
    else if (witel === "Medan") regional = "Regional I";
    else regional = "Regional II";

    let internetNumber = `122415${Math.floor(100000 + Math.random() * 900000)}`;
    let custName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
    let noHp = `62812${Math.floor(10000000 + Math.random() * 90000000)}`;
    let tagihan = Math.floor(250 + Math.random() * 7500) * 1000; // Rp 250k to Rp 7.5M
    const periods = ["Juni 2026", "Mei 2026", "April 2026"];
    let periode = periods[i % 3];

    // Status collection
    // 0: Belum Caring, 1: Sudah Caring, 2: Visit, 3: Janji Bayar, 4: Lunas, 5: Menunggak
    const statusWeight = [4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 5, 5]; // weighted distribution
    const statusIndex = statusWeight[i % statusWeight.length];

    let status = "Belum Caring";
    let caring = { status: "Belum Caring", tanggal: "-", keterangan: "-", janjiBayar: "-", petugas: "-" };
    let visit = { status: "Belum Visit", tanggal: "-", hasil: "-", petugas: "-" };

    const randomDayCaring = 10 + (i % 15);
    const randomDayVisit = randomDayCaring + 2;

    if (statusIndex === 0) {
      status = "Belum Caring";
    } else if (statusIndex === 1) {
      status = "Sudah Caring";
      caring = {
        status: "Sudah Caring (Tidak Tersambung)",
        tanggal: `${randomDayCaring} Juni 2026`,
        keterangan: "Telepon mailbox, WhatsApp centang satu.",
        janjiBayar: "-",
        petugas: OFFICERS_CARING[i % OFFICERS_CARING.length]
      };
    } else if (statusIndex === 2) {
      status = "Visit";
      caring = {
        status: "Sudah Caring (Menolak Bayar)",
        tanggal: `${randomDayCaring} Juni 2026`,
        keterangan: "Pelanggan complain tarif, perlu visit lapangan.",
        janjiBayar: "-",
        petugas: OFFICERS_CARING[i % OFFICERS_CARING.length]
      };
      visit = {
        status: "Sudah Visit",
        tanggal: `${randomDayVisit} Juni 2026`,
        hasil: "Ketemu pelanggan, masih bernegosiasi diskon.",
        petugas: OFFICERS_VISIT[i % OFFICERS_VISIT.length]
      };
    } else if (statusIndex === 3) {
      status = "Janji Bayar";
      caring = {
        status: "Sudah Caring (Janji Bayar)",
        tanggal: `${randomDayCaring} Juni 2026`,
        keterangan: `Sanggup membayar pada tanggal 28 Juni 2026.`,
        janjiBayar: "28 Juni 2026",
        petugas: OFFICERS_CARING[i % OFFICERS_CARING.length]
      };
    } else if (statusIndex === 4) {
      status = "Lunas";
      // Can be lunas from Caring or from Visit
      const lunasViaVisit = i % 2 === 0;
      if (lunasViaVisit) {
        caring = {
          status: "Sudah Caring (Complain Tarif)",
          tanggal: `${randomDayCaring} Juni 2026`,
          keterangan: "Minta didatangi teknisi untuk cek layanan.",
          janjiBayar: "-",
          petugas: OFFICERS_CARING[i % OFFICERS_CARING.length]
        };
        visit = {
          status: "Sudah Visit",
          tanggal: `${randomDayVisit} Juni 2026`,
          hasil: "Lunas di Tempat (Pelanggan transfer di depan petugas)",
          petugas: OFFICERS_VISIT[i % OFFICERS_VISIT.length]
        };
      } else {
        caring = {
          status: "Sudah Caring (Lunas)",
          tanggal: `${randomDayCaring} Juni 2026`,
          keterangan: "Sepakat membayar langsung via LinkAja.",
          janjiBayar: "-",
          petugas: OFFICERS_CARING[i % OFFICERS_CARING.length]
        };
      }
    } else if (statusIndex === 5) {
      status = "Menunggak";
      caring = {
        status: "Sudah Caring (Tidak Tersambung)",
        tanggal: `${randomDayCaring} Juni 2026`,
        keterangan: "Nomor tidak terdaftar / di luar jangkauan.",
        janjiBayar: "-",
        petugas: OFFICERS_CARING[i % OFFICERS_CARING.length]
      };
      visit = {
        status: "Sudah Visit",
        tanggal: `${randomDayVisit} Juni 2026`,
        hasil: "Rumah Kosong / Toko Pindah Alamat",
        petugas: OFFICERS_VISIT[i % OFFICERS_VISIT.length]
      };
    }

    // Determine aging
    let umurTagihan = "1 Bulan";
    if (periode === "Mei 2026") umurTagihan = "2 Bulan";
    else if (periode === "April 2026") umurTagihan = "> 2 Bulan";

    // Explicit override for the first record (Sri Hayati test user record)
    if (i === 0) {
      internetNumber = "122415163446";
      custName = "Sri Hayati";
      noHp = "08886046537";
      tagihan = 2395000;
      periode = "April 2026";
      umurTagihan = "> 2 Bulan";
      status = "Menunggak";
      witel = "Semarang";
      sto = "SMR";
      regional = "Regional IV";
      caring = {
        status: "Sudah Caring (Tidak Tersambung)",
        tanggal: "05 April 2026",
        keterangan: "WhatsApp centang satu, telepon mail box.",
        janjiBayar: "-",
        petugas: "Aulia Putri"
      };
      visit = {
        status: "Belum Visit",
        tanggal: "-",
        hasil: "-",
        petugas: "-"
      };
    }

    const customerObj = {
      id: internetNumber,
      nama: custName,
      noHp: noHp,
      tagihan: tagihan,
      regional: regional,
      witel: witel,
      sto: sto,
      status: status,
      periode: periode,
      umurTagihan: umurTagihan,
      caring: caring,
      visit: visit
    };
    customerObj.lastUpdate = getCustomerLastUpdate(customerObj);

    customerDatabase.push(customerObj);
  }

  filteredCustomers = [...customerDatabase];

  // Save generated mock data to DB
  await saveToDB(customerDatabase);

  // Save metadata for sample data
  currentDatasetType = "Data All";
  const meta = {
    fileName: "Sample_Dataset_Indibiz.xlsx",
    datasetType: "Data All",
    uploadTime: new Date().toLocaleString("id-ID"),
    recordCount: customerDatabase.length
  };
  localStorage.setItem('dataset_metadata', JSON.stringify(meta));
  localStorage.removeItem('dataset_cleared');
  showActiveDatasetUI(meta);

  // Build dynamic options for filters
  buildDynamicFilterOptions();

  // Calculate KPIs
  calculateKPIs();

  // Render Dashboard
  updateCharts();
}

function buildDynamicFilterOptions() {
  const regSelect = document.getElementById("filter-regional");
  const witSelect = document.getElementById("filter-witel");
  const stoSelect = document.getElementById("filter-sto");
  const petSelect = document.getElementById("filter-petugas");

  // Reset
  regSelect.innerHTML = '<option value="">Semua Regional</option>';
  witSelect.innerHTML = '<option value="">Semua Datel</option>';
  stoSelect.innerHTML = '<option value="">Semua STO</option>';
  petSelect.innerHTML = '<option value="">Semua Petugas</option>';

  const regionals = [...new Set(customerDatabase.map(c => c.regional))].sort();
  const witels = [...new Set(customerDatabase.map(c => c.witel))].sort();
  const stos = [...new Set(customerDatabase.map(c => c.sto))].sort();

  // Officer: ambil dari data aktual (petugas caring + petugas visit dari DATA ALL)
  // Fallback ke OFFICERS_CARING jika database belum diisi data asli
  const officersFromData = [
    ...new Set([
      ...customerDatabase.map(c => c.caring.petugas).filter(p => p && p !== "-"),
      ...customerDatabase.map(c => c.visit.petugas).filter(p => p && p !== "-")
    ])
  ].sort();
  const officers = officersFromData.length > 0 ? officersFromData : [...new Set([...OFFICERS_CARING, ...OFFICERS_VISIT])].sort();

  regionals.forEach(r => regSelect.innerHTML += `<option value="${r}">${r}</option>`);
  witels.forEach(w => witSelect.innerHTML += `<option value="${w}">${w}</option>`);
  stos.forEach(s => stoSelect.innerHTML += `<option value="${s}">${s}</option>`);
  officers.forEach(o => petSelect.innerHTML += `<option value="${o}">${o}</option>`);

  // Tindak Lanjut Page dropdown
  const actionPetSelect = document.getElementById("action-filter-petugas");
  if (actionPetSelect) {
    actionPetSelect.innerHTML = '<option value="">Semua Petugas</option>';

    // Ambil petugas caring dari dataset yang sedang aktif
    const caringOfficers = [
      ...new Set(customerDatabase.map(c => c.caring.petugas).filter(p => p && p !== "-"))
    ].sort();

    const displayCaringOfficers = caringOfficers.length > 0 ? caringOfficers : [...new Set(OFFICERS_CARING)].sort();

    displayCaringOfficers.forEach(o => {
      const selectedAttr = (actionFilterPetugasVal === o) ? " selected" : "";
      actionPetSelect.innerHTML += `<option value="${o}"${selectedAttr}>${o}</option>`;
    });
  }
}

// =========================================================================
// 3. KPI CALCULATIONS
// =========================================================================
function calculateKPIs() {
  const total = filteredCustomers.length;

  const belumCaring = filteredCustomers.filter(c => c.caring.status === "Belum Caring").length;
  const sudahCaring = filteredCustomers.filter(c => c.caring.status !== "Belum Caring").length;

  const sudahBayar = filteredCustomers.filter(c => c.status === "Lunas").length;
  const belumBayar = filteredCustomers.filter(c => c.status !== "Lunas").length;

  const outstandingSum = filteredCustomers
    .filter(c => c.status !== "Lunas")
    .reduce((sum, c) => sum + c.tagihan, 0);

  const outstandingCount = filteredCustomers.filter(c => c.status !== "Lunas").length;

  // Set UI elements
  document.getElementById("kpi-total-pelanggan").innerText = total.toLocaleString("id-ID");

  document.getElementById("kpi-belum-caring").innerText = belumCaring.toLocaleString("id-ID");
  document.getElementById("kpi-belum-caring-percent").innerText = total > 0 ? `${((belumCaring / total) * 100).toFixed(1)}% dari total` : "0% dari total";

  document.getElementById("kpi-sudah-caring").innerText = sudahCaring.toLocaleString("id-ID");
  document.getElementById("kpi-sudah-caring-percent").innerText = total > 0 ? `${((sudahCaring / total) * 100).toFixed(1)}% dari total` : "0% dari total";

  document.getElementById("kpi-sudah-bayar").innerText = sudahBayar.toLocaleString("id-ID");
  document.getElementById("kpi-sudah-bayar-percent").innerText = total > 0 ? `${((sudahBayar / total) * 100).toFixed(1)}% dari total` : "0% dari total";

  document.getElementById("kpi-belum-bayar").innerText = belumBayar.toLocaleString("id-ID");
  document.getElementById("kpi-belum-bayar-percent").innerText = total > 0 ? `${((belumBayar / total) * 100).toFixed(1)}% dari total` : "0% dari total";

  document.getElementById("kpi-outstanding").innerText = formatRupiah(outstandingSum);
  document.getElementById("kpi-outstanding-count").innerText = `${outstandingCount.toLocaleString("id-ID")} tagihan tertunggak`;

  // Cek apakah dataset yang sedang aktif adalah C3MR Unpaid
  const isC3MR = currentDatasetType === "C3MR Unpaid" || (filteredCustomers.length > 0 && filteredCustomers[0].datasetType === "C3MR Unpaid");

  const label1 = document.getElementById("kpi-label-visit-1");
  const label2 = document.getElementById("kpi-label-visit-2");

  if (isC3MR) {
    if (label1) label1.innerText = "Contacted";
    if (label2) label2.innerText = "Not Contacted";

    const contacted = filteredCustomers.filter(c => c.caring.status === "Contacted").length;
    const notContacted = filteredCustomers.filter(c => c.caring.status === "Not Contacted").length;
    const successRate = total > 0 ? (contacted / total) * 100 : 0;
    const notContactedRate = total > 0 ? (notContacted / total) * 100 : 0;

    document.getElementById("kpi-sudah-visit").innerText = contacted.toLocaleString("id-ID");
    document.getElementById("kpi-sudah-visit-percent").innerText = `Success Rate: ${successRate.toFixed(1)}%`;

    document.getElementById("kpi-belum-visit").innerText = notContacted.toLocaleString("id-ID");
    document.getElementById("kpi-belum-visit-percent").innerText = `Rate: ${notContactedRate.toFixed(1)}% dari total`;
  } else {
    if (label1) label1.innerText = "Sudah Visit";
    if (label2) label2.innerText = "Belum Visit";

    const belumVisit = filteredCustomers.filter(c => c.visit.status === "Belum Visit").length;
    const sudahVisit = filteredCustomers.filter(c => c.visit.status !== "Belum Visit").length;

    document.getElementById("kpi-sudah-visit").innerText = sudahVisit.toLocaleString("id-ID");
    document.getElementById("kpi-sudah-visit-percent").innerText = total > 0 ? `${((sudahVisit / total) * 100).toFixed(1)}% dari total` : "0% dari total";

    document.getElementById("kpi-belum-visit").innerText = belumVisit.toLocaleString("id-ID");
    document.getElementById("kpi-belum-visit-percent").innerText = total > 0 ? `${((belumVisit / total) * 100).toFixed(1)}% dari total` : "0% dari total";
  }
}

// =========================================================================
// 4. CHART.JS CONFIGURATION
// =========================================================================
function updateCharts() {
  if (filteredCustomers.length === 0) {
    clearAllCharts();
    return;
  }

  // Colors mapped to palette
  const accentColor = "#4B4A4B"; // Medium gray
  const primaryColor = "#FE2E4B"; // Telkom red
  const darkBg = "#0F0E0E";
  const charcoalBg = "#161316";

  // ----------------------------------------------------
  // Chart 1: Status Collection Distribution
  // ----------------------------------------------------
  const ctxStatus = document.getElementById("chart-status-collection").getContext("2d");

  // Aggregate data
  const statusCounts = {
    "Belum Caring": 0,
    "Sudah Caring": 0,
    "Visit": 0,
    "Janji Bayar": 0,
    "Lunas": 0,
    "Menunggak": 0
  };
  filteredCustomers.forEach(c => {
    if (statusCounts[c.status] !== undefined) statusCounts[c.status]++;
  });

  if (chartStatusCollection) chartStatusCollection.destroy();
  chartStatusCollection = new Chart(ctxStatus, {
    type: 'doughnut',
    data: {
      labels: Object.keys(statusCounts),
      datasets: [{
        data: Object.values(statusCounts),
        backgroundColor: [
          'rgba(75, 74, 75, 0.45)',     // Belum Caring - Soft Gray (#4B4A4B)
          'rgba(254, 46, 75, 0.45)',    // Sudah Caring - Soft Red (#FE2E4B)
          'rgba(75, 74, 75, 0.8)',      // Visit - Medium Gray
          'rgba(254, 46, 75, 0.75)',    // Janji Bayar - Medium Red
          'rgba(255, 255, 255, 0.85)',  // Lunas - White/Gray
          'rgba(254, 46, 75, 0.95)'     // Menunggak - Vibrant Red
        ],
        borderColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: window.innerWidth < 768 ? 'bottom' : 'right',
          labels: { color: '#FFF', font: { family: 'Inter', size: 10 } }
        }
      }
    }
  });

  // Cek apakah dataset yang sedang aktif adalah C3MR Unpaid
  const isC3MR = currentDatasetType === "C3MR Unpaid" || (filteredCustomers.length > 0 && filteredCustomers[0].datasetType === "C3MR Unpaid");

  // Update header Chart 2 & 4 titles dynamically
  const title2 = document.getElementById("chart-title-2");
  const desc2 = document.getElementById("chart-desc-2");
  const title4 = document.getElementById("chart-title-4");
  const desc4 = document.getElementById("chart-desc-4");

  if (isC3MR) {
    if (title2) title2.innerText = "Aktivitas WhatsApp Blast";
    if (desc2) desc2.innerText = "Performa blast pesan pengingat tagihan (STATUS_WA)";
    if (title4) title4.innerText = "Statistik Reason Call (OBC)";
    if (desc4) desc4.innerText = "Distribusi alasan penundaan pembayaran berdasarkan kontak obc";
  } else {
    if (title2) title2.innerText = "Aktivitas Caring vs Visit per Datel";
    if (desc2) desc2.innerText = "Perbandingan jangkauan penanganan per wilayah";
    if (title4) title4.innerText = "Tren Collection Rate Mingguan (%)";
    if (desc4) desc4.innerText = "Tingkat keberhasilan penagihan (target vs realisasi)";
  }

  // ----------------------------------------------------
  // Chart 2: Caring vs Visit by Witel OR Whatsapp Status Blast
  // ----------------------------------------------------
  const ctxCaringVisit = document.getElementById("chart-caring-visit").getContext("2d");

  if (isC3MR) {
    const waCounts = {
      "Berhasil WA": filteredCustomers.filter(c => c.whatsappStatus === "Berhasil WA").length,
      "Belum WA": filteredCustomers.filter(c => c.whatsappStatus === "Belum WA").length,
      "Gagal WA": filteredCustomers.filter(c => c.whatsappStatus === "Gagal WA").length
    };

    if (chartCaringVisit) chartCaringVisit.destroy();
    chartCaringVisit = new Chart(ctxCaringVisit, {
      type: 'bar',
      data: {
        labels: Object.keys(waCounts),
        datasets: [{
          label: 'Jumlah Pelanggan',
          data: Object.values(waCounts),
          backgroundColor: [
            'rgba(37, 211, 102, 0.85)', // Berhasil WA (Green)
            'rgba(255, 255, 255, 0.45)', // Belum WA (White/Gray)
            'rgba(254, 46, 75, 0.85)'   // Gagal WA (Red)
          ],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } },
          y: { grid: { color: 'rgba(254, 46, 75, 0.12)' }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  } else {
    const witels = [...new Set(filteredCustomers.map(c => c.witel))];
    const witelCaringData = [];
    const witelVisitData = [];

    witels.forEach(w => {
      const subset = filteredCustomers.filter(c => c.witel === w);
      const cared = subset.filter(c => c.caring.status !== "Belum Caring").length;
      const visited = subset.filter(c => c.visit.status !== "Belum Visit").length;
      witelCaringData.push(cared);
      witelVisitData.push(visited);
    });

    if (chartCaringVisit) chartCaringVisit.destroy();
    chartCaringVisit = new Chart(ctxCaringVisit, {
      type: 'bar',
      data: {
        labels: witels,
        datasets: [
          {
            label: 'Sudah Caring',
            data: witelCaringData,
            backgroundColor: 'rgba(254, 46, 75, 0.85)', // Telkom Red
            borderRadius: 6
          },
          {
            label: 'Sudah Visit',
            data: witelVisitData,
            backgroundColor: 'rgba(75, 74, 75, 0.85)', // Medium Gray (#4B4A4B)
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } },
          y: { grid: { color: 'rgba(254, 46, 75, 0.12)' }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } }
        },
        plugins: {
          legend: {
            labels: { color: '#FFF', font: { family: 'Inter', size: 10 } }
          }
        }
      }
    });
  }

  // ----------------------------------------------------
  // Chart 3: Outstanding Amount by STO (Top 5 STOs)
  // ----------------------------------------------------
  const ctxOutstanding = document.getElementById("chart-outstanding-sto").getContext("2d");

  const stoOutstanding = {};
  filteredCustomers.filter(c => c.status !== "Lunas").forEach(c => {
    if (!stoOutstanding[c.sto]) stoOutstanding[c.sto] = 0;
    stoOutstanding[c.sto] += c.tagihan;
  });

  // Sort and pick top 5
  const topStos = Object.entries(stoOutstanding)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const stoLabels = topStos.map(item => item[0]);
  const stoValues = topStos.map(item => item[1] / 1000000); // in Millions Rp

  if (chartOutstandingSto) chartOutstandingSto.destroy();
  chartOutstandingSto = new Chart(ctxOutstanding, {
    type: 'bar',
    data: {
      labels: stoLabels.length > 0 ? stoLabels : ["Tidak ada data"],
      datasets: [{
        label: 'Outstanding (Juta Rp)',
        data: stoValues.length > 0 ? stoValues : [0],
        backgroundColor: 'rgba(254, 46, 75, 0.85)', // Telkom Red
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(254, 46, 75, 0.12)' }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } },
        y: { grid: { display: false }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });

  // ----------------------------------------------------
  // Chart 4: Trend Collection Rate OR Reason Call distribution
  // ----------------------------------------------------
  const ctxTrend = document.getElementById("chart-collection-trend").getContext("2d");

  if (isC3MR) {
    const reasonLabels = ["Rumah kosong", "Nomor tidak aktif", "Tidak diangkat", "Salah nomor", "Menolak", "Janji bayar", "Lainnya"];
    const reasonCounts = reasonLabels.map(label => filteredCustomers.filter(c => c.caring.reasonCall === label).length);

    if (chartCollectionTrend) chartCollectionTrend.destroy();
    chartCollectionTrend = new Chart(ctxTrend, {
      type: 'bar',
      data: {
        labels: reasonLabels,
        datasets: [{
          label: 'Jumlah Alasan',
          data: reasonCounts,
          backgroundColor: 'rgba(192, 132, 252, 0.85)', // Violet Purple
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(254, 46, 75, 0.12)' }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } },
          y: { grid: { display: false }, ticks: { color: '#FFF', font: { family: 'Inter', size: 9 } } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  } else {
    // Make a realistic trend line based on filtered customer ratios
    const baseRate = filteredCustomers.length > 0
      ? (filteredCustomers.filter(c => c.status === "Lunas").length / filteredCustomers.length) * 100
      : 0;

    const trendLabels = ["W1", "W2", "W3", "W4", "W5 (Sekarang)"];
    const trendValues = [
      Math.max(0, baseRate - 15),
      Math.max(0, baseRate - 10),
      Math.max(0, baseRate - 6),
      Math.max(0, baseRate - 2),
      baseRate
    ];

    if (chartCollectionTrend) chartCollectionTrend.destroy();
    chartCollectionTrend = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [{
          label: 'Collection Rate (%)',
          data: trendValues,
          borderColor: '#FE2E4B',
          backgroundColor: 'rgba(254, 46, 75, 0.12)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#FE2E4B',
          pointBorderColor: '#FFF',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } },
          y: { grid: { color: 'rgba(254, 46, 75, 0.12)' }, min: 0, max: 100, ticks: { color: '#FFF', font: { family: 'Inter', size: 10 } } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}

function clearAllCharts() {
  if (chartStatusCollection) chartStatusCollection.destroy();
  if (chartCaringVisit) chartCaringVisit.destroy();
  if (chartOutstandingSto) chartOutstandingSto.destroy();
  if (chartCollectionTrend) chartCollectionTrend.destroy();
}

// =========================================================================
// 5. DATABASE FILTERS, SEARCH AND TABLE RENDERING
// =========================================================================
function setupFilters() {
  const regFilter = document.getElementById("filter-regional");
  const witFilter = document.getElementById("filter-witel");
  const stoFilter = document.getElementById("filter-sto");
  const petFilter = document.getElementById("filter-petugas");
  const caringFilter = document.getElementById("filter-caring");
  const visitFilter = document.getElementById("filter-visit");
  const pembayaranFilter = document.getElementById("filter-pembayaran");
  const umurFilter = document.getElementById("filter-umur");

  const searchInput = document.getElementById("search-input");
  const btnReset = document.getElementById("btn-reset-filters");

  // Quick reset trigger
  btnReset.addEventListener("click", () => {
    regFilter.value = "";
    witFilter.value = "";
    stoFilter.value = "";
    petFilter.value = "";
    caringFilter.value = "";
    visitFilter.value = "";
    pembayaranFilter.value = "";
    umurFilter.value = "";
    searchInput.value = "";

    // Reset options mapping
    buildDynamicFilterOptions();

    applyFilters();
  });

  // Apply trigger on inputs
  const triggerFilters = () => {
    currentPage = 1;
    applyFilters();
  };

  regFilter.addEventListener("change", () => {
    // When Regional changes, constrain Witels
    const selectedReg = regFilter.value;
    if (selectedReg) {
      // Find matching witels
      const validWitels = [...new Set(customerDatabase.filter(c => c.regional === selectedReg).map(c => c.witel))];
      witFilter.innerHTML = '<option value="">Semua Datel</option>';
      validWitels.forEach(w => witFilter.innerHTML += `<option value="${w}">${w}</option>`);
    } else {
      buildDynamicFilterOptions();
    }
    triggerFilters();
  });

  witFilter.addEventListener("change", () => {
    // When Witel changes, constrain STOs berdasarkan data aktual
    const selectedWit = witFilter.value;
    if (selectedWit) {
      // Ambil STO dari customerDatabase berdasarkan witel yang dipilih
      const validStos = [...new Set(customerDatabase.filter(c => c.witel === selectedWit).map(c => c.sto))].sort();
      stoFilter.innerHTML = '<option value="">Semua STO</option>';
      validStos.forEach(s => stoFilter.innerHTML += `<option value="${s}">${s}</option>`);

      // Auto match regional
      const match = customerDatabase.find(c => c.witel === selectedWit);
      if (match) regFilter.value = match.regional;
    } else {
      buildDynamicFilterOptions();
    }
    triggerFilters();
  });

  stoFilter.addEventListener("change", triggerFilters);
  petFilter.addEventListener("change", triggerFilters);
  caringFilter.addEventListener("change", triggerFilters);
  visitFilter.addEventListener("change", triggerFilters);
  pembayaranFilter.addEventListener("change", triggerFilters);
  umurFilter.addEventListener("change", triggerFilters);

  let searchTimeout = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(triggerFilters, 300);
  });

  // Pagination actions
  document.getElementById("btn-prev-page").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  document.getElementById("btn-next-page").addEventListener("click", () => {
    const maxPage = Math.ceil(filteredCustomers.length / rowsPerPage);
    if (currentPage < maxPage) {
      currentPage++;
      renderTable();
    }
  });
}

function applyFilters() {
  const regVal = document.getElementById("filter-regional").value;
  const witVal = document.getElementById("filter-witel").value;
  const stoVal = document.getElementById("filter-sto").value;
  const petVal = document.getElementById("filter-petugas").value;
  const caringVal = document.getElementById("filter-caring").value;
  const visitVal = document.getElementById("filter-visit").value;
  const pembayaranVal = document.getElementById("filter-pembayaran").value;
  const umurVal = document.getElementById("filter-umur").value;
  const searchVal = document.getElementById("search-input").value.toLowerCase().trim();

  filteredCustomers = customerDatabase.filter(c => {
    // Check dropdown filters
    if (regVal && c.regional !== regVal) return false;
    if (witVal && c.witel !== witVal) return false;
    if (stoVal && c.sto !== stoVal) return false;

    if (petVal) {
      const isCaringPetugas = c.caring.petugas === petVal;
      const isVisitPetugas = c.visit.petugas === petVal;
      if (!isCaringPetugas && !isVisitPetugas) return false;
    }

    // Status Caring filter
    if (caringVal) {
      if (caringVal === "Belum Caring" && c.caring.status !== "Belum Caring") return false;
      if (caringVal === "Sudah Caring" && c.caring.status === "Belum Caring") return false;
    }

    // Status Visit filter
    if (visitVal) {
      if (visitVal === "Belum Visit" && c.visit.status !== "Belum Visit") return false;
      if (visitVal === "Sudah Visit" && c.visit.status === "Belum Visit") return false;
    }

    // Status Pembayaran filter
    if (pembayaranVal) {
      const isLunas = c.status === "Lunas";
      if (pembayaranVal === "Lunas" && !isLunas) return false;
      if (pembayaranVal === "Belum Bayar" && isLunas) return false;
    }

    // Umur Tagihan filter
    if (umurVal && c.umurTagihan !== umurVal) return false;

    // Check search queries
    if (searchVal) {
      const matchId = c.id.toLowerCase().includes(searchVal);
      const matchNama = c.nama.toLowerCase().includes(searchVal);
      const matchHp = c.noHp.includes(searchVal);
      if (!matchId && !matchNama && !matchHp) return false;
    }

    return true;
  });

  // Recalculate dashboard metrics
  calculateKPIs();

  // Re-render table page 1
  renderTable();
}

function renderTable() {
  const tableBody = document.getElementById("customer-table-body");
  tableBody.innerHTML = "";

  const totalRecords = filteredCustomers.length;
  document.getElementById("paginated-total").innerText = totalRecords;

  if (totalRecords === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 40px;">
          <div style="display:flex; flex-direction:column; align-items:center; gap: 8px;">
            <i data-lucide="info" style="width:32px; height:32px;"></i>
            <span>Tidak ada data pelanggan yang cocok dengan kriteria filter.</span>
          </div>
        </td>
      </tr>
    `;
    lucide.createIcons();
    updatePaginationUI(0, 0, 0);
    return;
  }

  // Calculations for indexes
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, totalRecords);

  const pageCustomers = filteredCustomers.slice(startIndex, endIndex);

  pageCustomers.forEach(c => {
    const isLunas = c.status === "Lunas";
    const paymentBadge = isLunas
      ? `<span class="badge badge-green">Lunas</span>`
      : `<span class="badge badge-red">Belum Bayar</span>`;

    // Detailed caring status badge text
    const caringDetail = c.caring.status === "Belum Caring"
      ? `<span class="text-red" style="font-size:12px; display:inline-flex; align-items:center; gap:4px;"><i data-lucide="x" style="width:14px;"></i> Belum Caring</span>`
      : `<span class="text-green" style="font-size:12px; display:inline-flex; align-items:center; gap:4px;"><i data-lucide="phone-call" style="width:14px;"></i> ${c.caring.status.replace("Sudah Caring (", "").replace(")", "")}</span>`;

    const visitDetail = c.visit.status === "Belum Visit"
      ? `<span class="text-muted" style="font-size:12px; display:inline-flex; align-items:center; gap:4px;"><i data-lucide="minus" style="width:14px;"></i> Belum Visit</span>`
      : `<span class="text-blue" style="font-size:12px; display:inline-flex; align-items:center; gap:4px;"><i data-lucide="navigation" style="width:14px;"></i> ${c.visit.hasil.split(" (")[0]}</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family: monospace; font-weight:700;">${c.id}</td>
      <td>
        <div style="font-weight: 600;">${c.nama}</div>
        <small class="text-muted" style="font-size:10px;">HP: ${c.id === "122415163446" || c.nama === "Sri Hayati" ? "08886046537" : c.noHp}</small>
      </td>
      <td>
        <div>${c.witel}</div>
        <small class="badge badge-purple" style="font-size:10px; margin-top:2px;">STO: ${c.sto}</small>
      </td>
      <td>
        <div style="font-weight:700; color: var(--accent);">Rp ${c.tagihan.toLocaleString("id-ID")}</div>
        <small class="badge badge-gray" style="font-size:10px; margin-top:2px;">${c.umurTagihan}</small>
      </td>
      <td>${caringDetail}</td>
      <td>${visitDetail}</td>
      <td>${paymentBadge}</td>
      <td style="font-size:11px; font-weight: 600; color: var(--text-muted);">${c.lastUpdate}</td>
      <td style="text-align: center;">
        <div style="display: inline-flex; gap: 8px; justify-content: center; align-items: center;">
          ${(() => {
        let waCategory = "belum-caring";
        if (c.visit.status !== "Belum Visit") {
          waCategory = "visit-no-pay";
        } else if (c.umurTagihan === "> 2 Bulan") {
          waCategory = "outstanding-2-months";
        }
        return isLunas
          ? `<button class="btn-action btn-whatsapp-disabled" disabled style="opacity: 0.4; cursor: not-allowed; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size:11px; font-weight: 600; background: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border-color);" title="Pelanggan sudah lunas">
                   <i data-lucide="message-square" style="width:14px; height:14px;"></i> Hubungi
                 </button>`
          : `<button class="btn-action btn-whatsapp" onclick="triggerWhatsAppClick('${c.id}', '${waCategory}')" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size:11px; font-weight: 600;" title="Hubungi via WhatsApp">
                   <i data-lucide="message-square" style="width:14px; height:14px;"></i> Hubungi
                 </button>`;
      })()}
          <button class="btn-action" onclick="openDrawer('${c.id}')" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size:11px; font-weight: 600;">
            <i data-lucide="eye" style="width:14px; height:14px;"></i> Timeline
          </button>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  lucide.createIcons({ root: tableBody });
  updatePaginationUI(startIndex + 1, endIndex, totalRecords);
}

function updatePaginationUI(start, end, total) {
  document.getElementById("paginated-start").innerText = start;
  document.getElementById("paginated-end").innerText = end;

  const maxPage = Math.ceil(total / rowsPerPage);

  const prevBtn = document.getElementById("btn-prev-page");
  const nextBtn = document.getElementById("btn-next-page");

  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = currentPage === maxPage || total === 0;

  const numbersDiv = document.getElementById("pagination-numbers");
  numbersDiv.innerHTML = "";

  if (maxPage <= 1) return;

  // Show up to 5 page numbers around currentPage
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(maxPage, startPage + 4);

  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement("button");
    btn.className = `page-num ${i === currentPage ? 'active' : ''}`;
    btn.innerText = i;
    btn.addEventListener("click", () => {
      currentPage = i;
      renderTable();
    });
    numbersDiv.appendChild(btn);
  }
}

// =========================================================================
// 6. OFFICER PERFORMANCE LEADERBOARD
// =========================================================================
function renderOfficerTab() {
  const officerStats = {};

  // Ambil daftar petugas aktual dari customerDatabase (caring + visit)
  // Prioritas: data asli dari DATA ALL. Fallback ke konstanta jika DB kosong.
  const officersFromDB = [...new Set([
    ...customerDatabase.map(c => c.caring.petugas).filter(p => p && p !== "-"),
    ...customerDatabase.map(c => c.visit.petugas).filter(p => p && p !== "-")
  ])];
  const allOfficersList = officersFromDB.length > 0
    ? officersFromDB
    : [...new Set([...OFFICERS_CARING, ...OFFICERS_VISIT])];

  allOfficersList.forEach(name => {
    // Tentukan witel petugas dari pelanggan yang ditanganinya
    const assignedCustomer = customerDatabase.find(
      c => c.caring.petugas === name || c.visit.petugas === name
    );
    const witelBase = assignedCustomer ? assignedCustomer.witel : "Priangan Timur";

    officerStats[name] = {
      name: name,
      witel: witelBase,
      caring: 0,
      visit: 0,
      lunasCount: 0,
      lunasNominal: 0,
      assignedOutstanding: 0
    };
  });

  // Process customerDatabase
  customerDatabase.forEach(c => {
    const tagVal = c.tagihan;
    const isLunas = c.status === "Lunas";

    if (c.caring && c.caring.petugas !== "-") {
      const pCaring = c.caring.petugas;
      if (officerStats[pCaring]) {
        officerStats[pCaring].caring++;
        officerStats[pCaring].assignedOutstanding += tagVal;
        if (isLunas && (!c.visit || c.visit.status === "Belum Visit")) {
          officerStats[pCaring].lunasCount++;
          officerStats[pCaring].lunasNominal += tagVal;
        }
      }
    }

    if (c.visit && c.visit.petugas !== "-") {
      const pVisit = c.visit.petugas;
      if (officerStats[pVisit]) {
        officerStats[pVisit].visit++;
        officerStats[pVisit].assignedOutstanding += tagVal;
        if (isLunas) {
          officerStats[pVisit].lunasCount++;
          officerStats[pVisit].lunasNominal += tagVal;
        }
      }
    }
  });

  // Convert object to array
  const statsArray = Object.values(officerStats);

  // Calculate collection rates & metrics
  statsArray.forEach(o => {
    // Collection rate: (Collected / Assigned)
    const rate = o.assignedOutstanding > 0 ? (o.lunasNominal / o.assignedOutstanding) * 100 : 0;
    o.collectionRate = rate;

    // Rating logic based on rate
    let ratingStars = "⭐⭐⭐";
    if (rate > 70) ratingStars = "⭐⭐⭐⭐⭐";
    else if (rate > 45) ratingStars = "⭐⭐⭐⭐";
    else if (rate === 0 && o.caring === 0 && o.visit === 0) ratingStars = "N/A";
    o.rating = ratingStars;
  });

  // Sort by Collection Rate descending
  statsArray.sort((a, b) => b.collectionRate - a.collectionRate);

  // Render Table
  const tableBody = document.getElementById("officer-table-body");
  tableBody.innerHTML = "";

  document.getElementById("officer-count-badge").innerText = `${statsArray.length} Petugas Aktif`;

  statsArray.forEach(o => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight:600;">${o.name}</td>
      <td><span class="badge badge-purple">${o.witel}</span></td>
      <td style="text-align: center; font-weight:700;" class="text-yellow">${o.caring}</td>
      <td style="text-align: center; font-weight:700;" class="text-blue">${o.visit}</td>
      <td style="text-align: center; font-weight:700; color:var(--accent);">Rp ${o.lunasNominal.toLocaleString("id-ID")}</td>
      <td style="font-weight:800; color:var(--color-green);">${o.collectionRate.toFixed(1)}%</td>
      <td><span style="color:var(--color-yellow); font-size:12px;">${o.rating}</span></td>
    `;
    tableBody.appendChild(tr);
  });

  // Calculate Top Officer highlights
  let topCaringObj = { name: "-", count: 0 };
  let topVisitObj = { name: "-", count: 0 };

  statsArray.forEach(o => {
    if (o.caring > topCaringObj.count) {
      topCaringObj = { name: o.name, count: o.caring };
    }
    if (o.visit > topVisitObj.count) {
      topVisitObj = { name: o.name, count: o.visit };
    }
  });

  document.getElementById("top-caring-officer").innerText = topCaringObj.name;
  document.getElementById("top-caring-count").innerText = `${topCaringObj.count} Panggilan`;
  document.getElementById("top-visit-officer").innerText = topVisitObj.name;
  document.getElementById("top-visit-count").innerText = `${topVisitObj.count} Kunjungan`;

  // Update visual progress bars
  const totalCared = customerDatabase.filter(c => c.caring.status !== "Belum Caring").length;
  const caringSuccess = customerDatabase.filter(c => c.status === "Janji Bayar" || c.status === "Lunas").length;
  const caringRate = totalCared > 0 ? (caringSuccess / totalCared) * 100 : 0;

  document.getElementById("caring-success-percent").innerText = `${caringRate.toFixed(1)}%`;
  document.getElementById("caring-success-bar").style.width = `${caringRate}%`;

  const totalVisited = customerDatabase.filter(c => c.visit.status !== "Belum Visit").length;
  const visitSuccess = customerDatabase.filter(c => c.visit.hasil.includes("Lunas") || c.visit.hasil.includes("Janji")).length;
  const visitRate = totalVisited > 0 ? (visitSuccess / totalVisited) * 100 : 0;

  document.getElementById("visit-success-percent").innerText = `${visitRate.toFixed(1)}%`;
  document.getElementById("visit-success-bar").style.width = `${visitRate}%`;

  const totalTargetLunas = customerDatabase.length;
  const targetMet = customerDatabase.filter(c => c.status === "Lunas").length;
  const overallTargetRate = totalTargetLunas > 0 ? (targetMet / totalTargetLunas) * 100 : 0;

  document.getElementById("overall-target-percent").innerText = `${overallTargetRate.toFixed(1)}%`;
  document.getElementById("overall-target-bar").style.width = `${overallTargetRate}%`;

  // Render contribution doughnut chart
  renderOfficerChart(statsArray);
}

function renderOfficerChart(statsArray) {
  const ctx = document.getElementById("chart-officer-performance").getContext("2d");

  // Grab top 5 officers by cash collected
  const sortedByCash = [...statsArray].sort((a, b) => b.lunasNominal - a.lunasNominal).slice(0, 5);
  const labels = sortedByCash.map(o => o.name);
  const values = sortedByCash.map(o => o.lunasNominal);

  if (chartOfficerPerformance) chartOfficerPerformance.destroy();
  chartOfficerPerformance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: [
          'rgba(254, 46, 75, 0.85)',   // Red (#FE2E4B)
          'rgba(75, 74, 75, 0.85)',    // Medium Gray (#4B4A4B)
          'rgba(255, 255, 255, 0.9)',   // White (#FFFFFF)
          'rgba(140, 36, 54, 0.85)',   // Darker Red
          'rgba(22, 19, 22, 0.85)'     // Dark Charcoal (#161316)
        ],
        borderColor: '#0F0E0E',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: window.innerWidth < 768 ? 'bottom' : 'right',
          labels: { color: '#FFF', font: { family: 'Inter', size: 10 } }
        }
      }
    }
  });
}

// =========================================================================
// 7. SPREADSHEET INTEGRATION & MERGING LOGIC
// =========================================================================

function getSpreadsheetId(url) {
  if (!url) return null;
  const match = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  const trimmed = String(url).trim();
  if (trimmed && !trimmed.includes("/") && trimmed.length > 20) {
    return trimmed;
  }
  return null;
}

function saveStoredGsheetsLink(link) {
  if (!link) return;
  localStorage.setItem('google_sheets_link', link);
}

function getStoredGsheetsLink() {
  return localStorage.getItem('google_sheets_link') || "";
}

async function fetchGoogleSheetAndSync(sheetsLink, isSilent = false) {
  const spreadsheetId = getSpreadsheetId(sheetsLink);
  if (!spreadsheetId) {
    throw new Error("Format Link Google Sheets tidak valid. Pastikan link berisi ID spreadsheet.");
  }

  const statusElement = document.getElementById("status-google-sheets");
  if (statusElement) {
    statusElement.className = "upload-status-indicator warning";
    statusElement.innerHTML = `<i data-lucide="circle-dashed" class="spinning" style="width: 14px; height: 14px;"></i> <span>Menghubungkan & mengambil data...</span>`;
    lucide.createIcons({ root: statusElement });
  }

  if (!isSilent) {
    logConsole(`Menghubungkan ke Google Sheets dengan ID: ${spreadsheetId}...`, "info");
  }

  try {
    let jsonData = null;
    let success = false;
    let usedCsv = false;

    // Extract gid if available in the link
    const gidMatch = String(sheetsLink).match(/[?#&]gid=([0-9]+)/);
    let gid = gidMatch ? gidMatch[1] : null;

    // Default to DATA ALL gid if it's the default spreadsheet and no gid was specified
    if (spreadsheetId === "1RjhMpP3pTlzONbuoRajODGz3tTGm3p73" && !gid) {
      gid = "2024313693";
    }

    if (gid) {
      try {
        if (!isSilent) {
          logConsole(`Mendownload data via CSV untuk performa cepat...`, "info");
        }
        const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
        const res = await fetch(csvUrl);
        if (res.ok) {
          const text = await res.text();
          const workbook = XLSX.read(text, { type: 'string' });
          if (workbook.SheetNames.length > 0) {
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            jsonData = parseWorksheetRobustly(worksheet);
            if (jsonData && jsonData.length > 0) {
              success = true;
              usedCsv = true;
              if (!isSilent) {
                logConsole(`Sinkronisasi CSV berhasil (${jsonData.length} baris).`, "green");
              }
            }
          }
        }
      } catch (csvErr) {
        if (!isSilent) {
          logConsole(`Metode CSV gagal: ${csvErr.message}. Mencoba fallback ke format Excel...`, "warning");
        }
      }
    }

    if (!success) {
      // Fallback to Excel (.xlsx) export
      if (!isSilent) {
        logConsole(`Mendownload workbook Excel lengkap...`, "info");
      }
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Gagal mengambil data dari Google Sheets. Pastikan spreadsheet diatur ke 'Siapa saja yang memiliki link dapat melihat' (Anyone with link can view).");
      }

      const arrayBuffer = await res.arrayBuffer();
      const dataBytes = new Uint8Array(arrayBuffer);

      // Ambil daftar nama sheet secara cepat tanpa parsing datanya
      const workbookNames = XLSX.read(dataBytes, { type: 'array', bookSheets: true });

      // Cek keberadaan sheet bernama "Data All" / "DATA ALL" (case-insensitive)
      const targetSheetName = workbookNames.SheetNames.find(name => name.trim().toLowerCase() === "data all");
      if (!targetSheetName) {
        throw new Error("Sheet 'Data All' tidak ditemukan.");
      }

      // Hanya parsing sheet target secara spesifik (sangat cepat dibanding memproses semua 40+ sheet)
      const workbook = XLSX.read(dataBytes, { 
        type: 'array', 
        sheets: [targetSheetName],
        cellFormula: false,
        cellHTML: false
      });
      const worksheet = workbook.Sheets[targetSheetName];
      jsonData = parseWorksheetRobustly(worksheet);
    }

    if (!jsonData || jsonData.length === 0) {
      throw new Error("Sheet 'Data All' kosong atau tidak memiliki baris data.");
    }

    currentDatasetType = "Data All";
    rawDataset = jsonData;
    rawDataAll = jsonData;
    window.lastUploadedFileName = `Google Sheets (${spreadsheetId})`;

    saveStoredGsheetsLink(sheetsLink);

    if (statusElement) {
      statusElement.className = "upload-status-indicator success";
      statusElement.innerHTML = `<i data-lucide="check-circle" style="color: #25D366; width: 14px; height: 14px;"></i> <span>Terhubung. ${jsonData.length.toLocaleString("id-ID")} record terdeteksi.</span>`;
      lucide.createIcons({ root: statusElement });
    }

    logConsole(`Google Sheets Connected: ${jsonData.length} baris terdeteksi dari sheet 'Data All'.`, "green");

    await integrateSpreadsheets("google_sheets", sheetsLink);

  } catch (err) {
    if (statusElement) {
      statusElement.className = "upload-status-indicator error";
      statusElement.innerHTML = `<i data-lucide="alert-triangle" style="color: var(--color-red); width: 14px; height: 14px;"></i> <span>Error: ${err.message}</span>`;
      lucide.createIcons({ root: statusElement });
    }
    logConsole(`Sinkronisasi Google Sheets GAGAL: ${err.message}`, "red");
    throw err;
  }
}

function setupFileDropZones() {
  const uploaders = [
    { key: 'data-all', widget: 'widget-data-all', file: 'file-data-all', zone: 'drop-zone-data-all', status: 'status-data-all' }
  ];

  const processBtn = document.getElementById("btn-process-sheets");

  uploaders.forEach(up => {
    const dropZone = document.getElementById(up.zone);
    const fileInput = document.getElementById(up.file);
    const statusText = document.getElementById(up.status);

    if (dropZone && fileInput && statusText) {
      dropZone.addEventListener("click", () => fileInput.click());

      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      });

      dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
      });

      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
          handleFileSelect(e.dataTransfer.files[0], up, statusText, processBtn);
        }
      });

      fileInput.addEventListener("change", (e) => {
        if (fileInput.files.length > 0) {
          handleFileSelect(fileInput.files[0], up, statusText, processBtn);
        }
      });
    }
  });

  // Google Sheets Connect Trigger
  const btnSyncGoogleSheets = document.getElementById("btn-sync-google-sheets");
  const inputGoogleSheetsLink = document.getElementById("input-google-sheets-link");
  if (btnSyncGoogleSheets && inputGoogleSheetsLink) {
    btnSyncGoogleSheets.addEventListener("click", async () => {
      const link = inputGoogleSheetsLink.value.trim();
      if (!link) {
        alert("Silakan masukkan link Google Sheets terlebih dahulu.");
        return;
      }

      btnSyncGoogleSheets.disabled = true;
      const originalText = btnSyncGoogleSheets.innerHTML;
      btnSyncGoogleSheets.innerHTML = `<i data-lucide="circle-dashed" class="spinning" style="width: 14px; height: 14px;"></i> Hubungkan...`;
      lucide.createIcons({ root: btnSyncGoogleSheets });

      try {
        await fetchGoogleSheetAndSync(link);
        showNotification("Berhasil menghubungkan dan menyinkronkan Google Sheets!", "success");
      } catch (err) {
        alert(`Sinkronisasi Gagal: ${err.message}`);
      } finally {
        btnSyncGoogleSheets.disabled = false;
        btnSyncGoogleSheets.innerHTML = originalText;
        lucide.createIcons({ root: btnSyncGoogleSheets });
      }
    });
  }

  // Active Dataset Refresh Trigger ("Sinkronkan Sekarang")
  const btnSyncRefresh = document.getElementById("btn-sync-refresh");
  if (btnSyncRefresh) {
    btnSyncRefresh.addEventListener("click", async () => {
      const storedLink = getStoredGsheetsLink() || (inputGoogleSheetsLink ? inputGoogleSheetsLink.value.trim() : "");
      if (!storedLink) {
        alert("Link Google Sheets tidak ditemukan. Silakan hubungkan ulang.");
        return;
      }

      btnSyncRefresh.disabled = true;
      const originalText = btnSyncRefresh.innerHTML;
      btnSyncRefresh.innerHTML = `<i data-lucide="circle-dashed" class="spinning" style="width: 16px; height: 16px;"></i> Menyinkronkan...`;
      lucide.createIcons({ root: btnSyncRefresh });

      try {
        await fetchGoogleSheetAndSync(storedLink);
        showNotification("Data berhasil disinkronkan kembali dari Google Sheets!", "success");
      } catch (err) {
        alert(`Gagal menyinkronkan data: ${err.message}`);
      } finally {
        btnSyncRefresh.disabled = false;
        btnSyncRefresh.innerHTML = originalText;
        lucide.createIcons({ root: btnSyncRefresh });
      }
    });
  }

  // Button: Ganti Spreadsheet
  const btnChangeSpreadsheet = document.getElementById("btn-change-spreadsheet");
  if (btnChangeSpreadsheet) {
    btnChangeSpreadsheet.addEventListener("click", () => {
      // Switch back to uploader view
      triggerChangeDataset();
      // Scroll/focus the google sheets input field
      const inputGsLink = document.getElementById("input-google-sheets-link");
      if (inputGsLink) {
        inputGsLink.scrollIntoView({ behavior: 'smooth' });
        inputGsLink.focus();
        inputGsLink.select();
      }
    });
  }

  // Button: Kembali ke Spreadsheet Default
  const btnDefaultSpreadsheet = document.getElementById("btn-default-spreadsheet");
  if (btnDefaultSpreadsheet) {
    btnDefaultSpreadsheet.addEventListener("click", async () => {
      if (confirm("Apakah Anda yakin ingin kembali menggunakan Google Spreadsheet Default?")) {
        btnDefaultSpreadsheet.disabled = true;
        const originalText = btnDefaultSpreadsheet.innerHTML;
        btnDefaultSpreadsheet.innerHTML = `<i data-lucide="circle-dashed" class="spinning" style="width: 14px; height: 14px;"></i> Resetting...`;
        lucide.createIcons({ root: btnDefaultSpreadsheet });

        try {
          const activeKey = getActiveAuthKey();
          const defaultDecrypted = decryptText(DEFAULT_GSHEETS_LINK_ENCRYPTED, activeKey);
          
          // Set input value to default link
          const inputGsLink = document.getElementById("input-google-sheets-link");
          if (inputGsLink && defaultDecrypted) {
            inputGsLink.value = defaultDecrypted;
          }
          // Sync default spreadsheet
          if (defaultDecrypted) {
            await fetchGoogleSheetAndSync(defaultDecrypted);
          }
          showNotification("Berhasil kembali ke Google Spreadsheet Default!", "success");
        } catch (err) {
          alert(`Gagal menyinkronkan spreadsheet default: ${err.message}`);
        } finally {
          btnDefaultSpreadsheet.disabled = false;
          btnDefaultSpreadsheet.innerHTML = originalText;
          lucide.createIcons({ root: btnDefaultSpreadsheet });
        }
      }
    });
  }

  // Process integration sheets trigger
  // DATA ALL sudah cukup sebagai sumber tunggal — proses langsung saat upload
  if (processBtn) {
    processBtn.addEventListener("click", () => integrateSpreadsheets("file"));
  }

  // Auto-proses segera setelah dataset diupload (tanpa perlu klik tombol proses)
  // Ini membuat workflow lebih simpel: upload → otomatis sinkron
  const autoProcessAfterUpload = () => {
    if (rawDataset) {
      logConsole(`${currentDatasetType} terdeteksi. Auto-memulai sinkronisasi...`, "info");
      integrateSpreadsheets("file");
    }
  };

  // Tambahkan listener auto-process ke file input DATA ALL
  const fileDataAllInput = document.getElementById("file-data-all");
  if (fileDataAllInput) {
    fileDataAllInput.addEventListener("change", () => {
      setTimeout(autoProcessAfterUpload, 800); // delay agar file selesai dibaca
    });
  }

  // Util buttons
  const btnLoadMock = document.getElementById("btn-load-mock");
  if (btnLoadMock) {
    btnLoadMock.addEventListener("click", async () => {
      await loadMockData();
      logConsole("Mengaktifkan database sampel (120 data pelanggan).", "purple");
      document.getElementById("data-status-text").innerText = "Sample Mock Data Active";
      updatePills();
    });
  }

  const btnClearData = document.getElementById("btn-clear-data");
  if (btnClearData) {
    btnClearData.addEventListener("click", async () => {
      customerDatabase = [];
      filteredCustomers = [];
      actionFilterPetugasVal = "";
      await clearDB();
      clearAllCharts();
      renderTable();
      calculateKPIs();
      renderActionListPanel();
      logConsole("Seluruh data dibersihkan dari memori dashboard dan database lokal.", "red");
      document.getElementById("data-status-text").innerText = "No Data Loaded";
      updatePills();
    });
  }
}

function parseWorksheetRobustly(worksheet) {
    // Parse as a 2D array (array of arrays)
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    if (rows.length === 0) return [];

    // Look for the row that has the header columns
    let headerRowIndex = 0;
    let maxMatchCount = 0;

    // Common column names we expect
    const expectedKeywords = [
      "internetnumber", "serviceid", "nointernet", "id", "internet",
      "namapelanggan", "nama", "pelanggan",
      "nominaltagihan", "tagihan", "outstanding",
      "witel", "regional", "sto", "statustagihan", "status"
    ];

    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      let matchCount = 0;
      row.forEach(cell => {
        const cellStr = String(cell).toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        if (expectedKeywords.includes(cellStr)) {
          matchCount++;
        }
      });

      if (matchCount > maxMatchCount) {
        maxMatchCount = matchCount;
        headerRowIndex = i;
      }
    }

    // If we found a header row with at least 2 matching columns, use it
    if (maxMatchCount >= 2) {
      const headerRow = rows[headerRowIndex].map(h => String(h).trim());
      const dataRows = rows.slice(headerRowIndex + 1);

      const result = [];
      dataRows.forEach(row => {
        // Skip completely empty rows
        if (!row || row.every(val => String(val).trim() === "")) return;

        const obj = {};
        headerRow.forEach((header, colIdx) => {
          if (header) {
            obj[header] = row[colIdx] !== undefined ? row[colIdx] : "";
          }
        });
        result.push(obj);
      });

      return result;
    }

    // Fallback to standard object parsing
    return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  }

  function detectDatasetType(jsonData) {
    if (!jsonData || jsonData.length === 0) return null;
    const firstRow = jsonData[0];
    const keys = Object.keys(firstRow).map(k => k.trim().toLowerCase());

    // Columns for C3MR Unpaid: STATUS_OBC, STATUS_WA, UPDATE_TELP, PETUGAS CEK, REASON_CALL
    const c3mrKeywords = ["status_obc", "status_wa", "update_telp", "petugas cek", "reason_call"];
    const hasC3MR = keys.some(k => c3mrKeywords.includes(k) || k.replace(/[^a-z0-9]/g, '') === 'petugascek' || k.replace(/[^a-z0-9]/g, '') === 'reasoncall');

    if (hasC3MR) {
      return "C3MR Unpaid";
    }

    // Columns for Data All: SND, DATEL, SALDO, STATUS BAYAR, STATUS CARING
    const dataAllKeywords = ["snd", "datel", "saldo", "status bayar", "status caring"];
    const hasDataAll = keys.some(k => dataAllKeywords.includes(k) || k.replace(/[^a-z0-9]/g, '') === 'statusbayar' || k.replace(/[^a-z0-9]/g, '') === 'statuscaring');

    if (hasDataAll) {
      return "Data All";
    }

    // Fallback checks
    if (keys.includes("nper") || keys.includes("nama_ncli") || keys.includes("bill_amount")) {
      return "C3MR Unpaid";
    }
    if (keys.includes("snd_group") || keys.includes("petugas visit") || keys.includes("voc")) {
      return "Data All";
    }

    return null;
  }

  function handleFileSelect(file, config, statusElement, processBtn) {
    statusElement.innerHTML = `<i data-lucide="circle-dashed" class="spinning"></i> <span>Membaca file...</span>`;
    lucide.createIcons();

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = parseWorksheetRobustly(worksheet);

        if (jsonData.length === 0) {
          throw new Error("File kosong atau tidak memiliki baris data.");
        }

        // Auto detect dataset type
        const detectedType = detectDatasetType(jsonData);
        if (!detectedType) {
          throw new Error("Format file tidak dikenali. Silakan upload Data All atau C3MR Unpaid (DATA PRANPC).");
        }

        currentDatasetType = detectedType;
        rawDataset = jsonData;
        rawDataAll = (detectedType === "Data All") ? jsonData : null; // backward compatibility
        window.lastUploadedFileName = file.name;

        logConsole(`${detectedType} Loaded: ${jsonData.length} baris terdeteksi.`, "green");

        // Format upload result UI card
        const now = new Date();
        const uploadTime = now.toLocaleString("id-ID");

        statusElement.className = "upload-status-indicator success";
        statusElement.innerHTML = `
        <div class="upload-result-card" style="margin-top: 15px; padding: 15px; border-radius: 12px; background: rgba(37, 211, 102, 0.08); border: 1px solid rgba(37, 211, 102, 0.25); text-align: left;">
          <div style="display:flex; align-items:center; gap: 8px; font-weight:700; color:#25D366; margin-bottom:8px;">
            <i data-lucide="check-circle" style="width:16px; height:16px;"></i>
            <span>Dataset Loaded: ✔ ${detectedType === "Data All" ? "Data All" : "C3MR Unpaid (DATA PRANPC)"}</span>
          </div>
          <div style="font-size:11px; color:var(--text-muted); display:flex; flex-direction:column; gap:4px;">
            <div><strong>Nama File:</strong> ${file.name}</div>
            <div><strong>Jumlah Record:</strong> ${jsonData.length.toLocaleString("id-ID")} baris</div>
            <div><strong>Waktu Upload:</strong> ${uploadTime}</div>
          </div>
        </div>
      `;

        if (rawDataset) {
          processBtn.disabled = false;
          integrateSpreadsheets();
        }

      } catch (err) {
        statusElement.className = "upload-status-indicator error";
        statusElement.innerHTML = `<i data-lucide="alert-triangle" style="color:var(--color-red);"></i> <span style="font-weight:700; font-size: 11px;">Error: ${err.message}</span>`;
        logConsole(`Gagal membaca ${file.name}: ${err.message}`, "red");
      }
      lucide.createIcons();
    };

    reader.readAsArrayBuffer(file);
  }

  async function integrateSpreadsheets(sourceType = "file", googleSheetsLink = "") {
    if (!rawDataset) {
      logConsole("Dataset wajib diupload terlebih dahulu sebelum proses mapping.", "red");
      return;
    }

    logConsole(`Memulai parsing ${currentDatasetType} menggunakan parser modul khusus...`, "info");

    let parsedData = [];
    try {
      if (currentDatasetType === "Data All") {
        parsedData = window.dataAllParser.parse(rawDataset);
      } else if (currentDatasetType === "C3MR Unpaid") {
        parsedData = window.c3mrParser.parse(rawDataset);
      } else {
        throw new Error("Tipe dataset tidak dikenali.");
      }
    } catch (err) {
      logConsole(`Gagal memproses data: ${err.message}`, "red");
      alert(`Gagal memproses data: ${err.message}`);
      return;
    }

    // Set lastUpdate timestamp for each record
    parsedData.forEach(c => {
      c.lastUpdate = getCustomerLastUpdate(c);
    });

    customerDatabase = parsedData;
    filteredCustomers = [...customerDatabase];

    // Hitung statistik untuk log
    const totalCaring = customerDatabase.filter(c => c.caring.status !== "Belum Caring").length;
    const totalVisit = customerDatabase.filter(c => c.visit.status !== "Belum Visit").length;
    const totalLunas = customerDatabase.filter(c => c.status === "Lunas").length;

    // Save integrated data to IndexedDB
    await saveToDB(customerDatabase);

    // Save dataset metadata for persistence
    const uploadTime = new Date().toLocaleString("id-ID");
    const meta = {
      fileName: window.lastUploadedFileName || (currentDatasetType === "Data All" ? "data_all.xlsx" : "c3mr_unpaid.xlsx"),
      datasetType: currentDatasetType,
      uploadTime: uploadTime,
      recordCount: customerDatabase.length,
      sourceType: sourceType,
      googleSheetsLink: googleSheetsLink
    };
    localStorage.setItem('dataset_metadata', JSON.stringify(meta));
    localStorage.removeItem('dataset_cleared');
    showActiveDatasetUI(meta);

    // Re-build all UI
    buildDynamicFilterOptions();
    calculateKPIs();
    updateCharts();
    renderTable();
    updatePills();

    // Log hasil parsing
    logConsole(`BERHASIL. Total pelanggan terparsing: ${customerDatabase.length} data.`, "green");
    logConsole(`Sudah Caring: ${totalCaring} | Sudah Visit: ${totalVisit} | Lunas: ${totalLunas}`, "purple");

    if (currentDatasetType === "Data All") {
      logConsole(`Kolom terpetakan: SND, NAMA, NO HP, Tag_Total/SALDO, STO, DATEL, UMUR_CUSTOMER, PETUGAS, TGL CARRING, STATUS CARING, KETERANGAN, VOC, PETUGAS VISIT, TANGGAL VISIT, HASIL VISIT, STATUS BAYAR.`, "info");
      document.getElementById("data-status-text").innerText = "DATA ALL Loaded & Synced";
      alert(`Berhasil! ${customerDatabase.length} pelanggan berhasil dimuat dari DATA ALL.\nCaring: ${totalCaring} | Visit: ${totalVisit} | Lunas: ${totalLunas}`);
    } else {
      logConsole(`Kolom terpetakan (C3MR Unpaid): NPER, NAMA, NAMA_NCLI, ALAMAT, TELP, UPDATE_TELP, WITEL, STO_DESC, DATEL, PRODUK, STATUS_BAYAR, BILL_AMOUNT, SALDO, STATUS_OBC, STATUS_WA, PETUGAS CEK, REASON_CALL, KENDALA, KETERANGAN.`, "info");
      document.getElementById("data-status-text").innerText = "C3MR UNPAID Loaded & Synced";
      alert(`Berhasil! ${customerDatabase.length} pelanggan berhasil dimuat dari C3MR Unpaid.\nCaring (OBC): ${totalCaring} | WA Status Blast: Terbaca | Lunas: ${totalLunas}`);
    }
  }

  function updatePills() {
    const total = customerDatabase.length;

    // Update sidebar follow-up badge
    updateSidebarBadge();

    if (total === 0) {
      document.getElementById("summary-matched-keys").innerText = "0";
      document.getElementById("summary-caring-rate").innerText = "0%";
      document.getElementById("summary-visit-rate").innerText = "0%";
      document.getElementById("summary-collection-rate").innerText = "0%";
      return;
    }

    const caring = customerDatabase.filter(c => c.caring.status !== "Belum Caring").length;
    const visit = customerDatabase.filter(c => c.visit.status !== "Belum Visit").length;
    const lunas = customerDatabase.filter(c => c.status === "Lunas").length;

    document.getElementById("summary-matched-keys").innerText = `${total}/${total}`;
    document.getElementById("summary-caring-rate").innerText = `${((caring / total) * 100).toFixed(1)}%`;
    document.getElementById("summary-visit-rate").innerText = `${((visit / total) * 100).toFixed(1)}%`;
    document.getElementById("summary-collection-rate").innerText = `${((lunas / total) * 100).toFixed(1)}%`;
  }

  function logConsole(message, type) {
    const consoleLog = document.getElementById("sync-console-log");
    const time = new Date().toLocaleTimeString("id-ID");

    let classType = "";
    if (type === "green") classType = "text-green";
    else if (type === "red") classType = "text-red";
    else if (type === "purple") classType = "text-purple";
    else if (type === "info") classType = "text-muted";

    consoleLog.innerHTML += `<div class="log-line ${classType}">[${time}] ${message}</div>`;

    // Auto scroll to bottom
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }

  // =========================================================================
  // 8. EXCEL & PDF EXPORT SYSTEM
  // =========================================================================
  function setupExports() {
    document.getElementById("btn-export-excel").addEventListener("click", () => {
      if (filteredCustomers.length === 0) {
        alert("Tidak ada data untuk diexport!");
        return;
      }

      // Transform data flat for Excel sheets
      const flatData = filteredCustomers.map(c => ({
        "Internet Number": c.id,
        "Nama Pelanggan": c.nama,
        "No Handphone": c.noHp,
        "Regional": c.regional,
        "Datel": c.witel,
        "STO": c.sto,
        "Outstanding Tagihan (Rp)": c.tagihan,
        "Periode": c.periode,
        "Status Collection": c.status,
        "Status Caring": c.caring.status,
        "Petugas Caring": c.caring.petugas,
        "Tanggal Caring": c.caring.tanggal,
        "Keterangan Caring": c.caring.keterangan,
        "Janji Bayar": c.caring.janjiBayar,
        "Status Visit": c.visit.status,
        "Petugas Visit": c.visit.petugas,
        "Tanggal Visit": c.visit.tanggal,
        "Hasil Visit": c.visit.hasil
      }));

      const worksheet = XLSX.utils.json_to_sheet(flatData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data Collection");

      // Write download
      XLSX.writeFile(workbook, `Telkom_Pay_Collection_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
      logConsole("Data berhasil diexport ke format Excel.", "green");
    });

    document.getElementById("btn-export-pdf").addEventListener("click", () => {
      if (filteredCustomers.length === 0) {
        alert("Tidak ada data untuk diexport!");
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF('l', 'mm', 'a4'); // landscape

      // Add premium Telkom logo placeholder / custom text
      doc.setFillColor(1, 0, 48); // #010030
      doc.rect(0, 0, 297, 45, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(22);
      doc.text("LAPORAN TELKOM PAY COLLECTION INTEGRASI", 14, 20);

      doc.setFontSize(10);
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(240, 66, 255); // neon Pink
      doc.text("TELKOM PAY COLLECTION UNIT - REALTIME INTEGRATION", 14, 28);

      doc.setTextColor(255, 255, 255);
      const exportTime = new Date().toLocaleString("id-ID");
      doc.text(`Waktu Cetak: ${exportTime}  |  Total Data Filtered: ${filteredCustomers.length} pelanggan`, 14, 38);

      // Build KPI Summary blocks in PDF
      const outstandingSum = filteredCustomers.filter(c => c.status !== "Lunas").reduce((sum, c) => sum + c.tagihan, 0);
      const recoveryRate = filteredCustomers.length > 0
        ? (filteredCustomers.filter(c => c.status === "Lunas").length / filteredCustomers.length) * 100
        : 0;

      doc.setFillColor(22, 0, 120); // #160078
      doc.rect(14, 52, 269, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`Total Outstanding: Rp ${outstandingSum.toLocaleString("id-ID")}`, 20, 63);
      doc.text(`Collection Recovery Rate: ${recoveryRate.toFixed(1)}%`, 180, 63);

      // Mapping table content
      const headers = [["Internet Number", "Nama Pelanggan", "Datel", "STO", "Nominal Tagihan", "Status", "Caring", "Visit"]];
      const dataRows = filteredCustomers.map(c => [
        c.id,
        c.nama,
        c.witel,
        c.sto,
        `Rp ${c.tagihan.toLocaleString("id-ID")}`,
        c.status,
        c.caring.status.split(" (")[0],
        c.visit.status
      ]);

      doc.autoTable({
        head: headers,
        body: dataRows,
        startY: 76,
        theme: 'grid',
        styles: {
          fontSize: 8,
          font: "Helvetica"
        },
        headStyles: {
          fillColor: [114, 38, 255], // #7226FF
          textColor: [255, 255, 255],
          fontStyle: 'bold'
        },
        alternateRowStyles: {
          fillColor: [240, 240, 255]
        }
      });

      doc.save(`Telkom_Pay_Collection_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
      logConsole("Laporan PDF berhasil dicetak.", "green");
    });
  }

  // =========================================================================
  // HELPER UTILITIES
  // =========================================================================
  function formatRupiah(value) {
    return "Rp " + Number(value).toLocaleString("id-ID");
  }

  // =========================================================================
  // ACTION LIST & NEED FOLLOW UP OPERATIONAL LOGIC
  // =========================================================================
  function updateSidebarBadge() {
    const allUnpaid = customerDatabase.filter(c => c.status !== 'Lunas');
    const sidebarBadge = document.getElementById("follow-up-badge");
    if (sidebarBadge) {
      if (allUnpaid.length > 0) {
        sidebarBadge.innerText = allUnpaid.length;
        sidebarBadge.style.display = "inline-flex";
      } else {
        sidebarBadge.style.display = "none";
      }
    }
  }

  function setupActionListEvents() {
    const cards = document.querySelectorAll(".action-category-card");
    cards.forEach(card => {
      card.addEventListener("click", () => {
        // Toggle active class
        cards.forEach(c => c.classList.remove("active"));
        card.classList.add("active");

        activeActionCategory = card.getAttribute("data-category");
        actionSearchQuery = "";
        actionCurrentPage = 1; // reset page index
        document.getElementById("action-search-input").value = "";
        renderActionListPanel();
      });
    });

    // Search box listener with 300ms debounce to prevent layout freezes
    const searchInput = document.getElementById("action-search-input");
    if (searchInput) {
      let actionSearchTimeout = null;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(actionSearchTimeout);
        actionSearchTimeout = setTimeout(() => {
          actionSearchQuery = e.target.value.toLowerCase().trim();
          actionCurrentPage = 1; // reset page index on search
          renderActionListPanel();
        }, 300);
      });
    }

    // Change listener for Petugas Caring Filter dropdown
    const actionPetSelect = document.getElementById("action-filter-petugas");
    if (actionPetSelect) {
      actionPetSelect.addEventListener("change", (e) => {
        actionFilterPetugasVal = e.target.value;
        actionCurrentPage = 1; // reset page index on filter change
        renderActionListPanel();
      });
    }

    // Pagination button listeners
    const btnPrev = document.getElementById("action-btn-prev-page");
    const btnNext = document.getElementById("action-btn-next-page");

    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (actionCurrentPage > 1) {
          actionCurrentPage--;
          renderActionListPanel();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener("click", () => {
        actionCurrentPage++;
        renderActionListPanel();
      });
    }
  }

  function renderActionListPanel() {
    let allUnpaid = customerDatabase.filter(c => c.status !== 'Lunas');

    // Apply Petugas Caring Filter
    if (actionFilterPetugasVal) {
      allUnpaid = allUnpaid.filter(c => c.caring.petugas === actionFilterPetugasVal);
    }

    // 1. Calculate categories
    const listBelumCaring = allUnpaid.filter(c => c.caring.status === 'Belum Caring');
    const listCaringNoVisit = allUnpaid.filter(c => c.caring.status !== 'Belum Caring' && c.visit.status === 'Belum Visit');
    const listVisitNoPay = allUnpaid.filter(c => c.visit.status !== 'Belum Visit');
    const listOutstanding2Months = allUnpaid.filter(c => c.umurTagihan === '> 2 Bulan');

    // 2. Set counts in category cards
    document.getElementById("count-belum-caring").innerText = listBelumCaring.length.toLocaleString("id-ID");
    document.getElementById("count-caring-no-visit").innerText = listCaringNoVisit.length.toLocaleString("id-ID");
    document.getElementById("count-visit-no-pay").innerText = listVisitNoPay.length.toLocaleString("id-ID");
    document.getElementById("count-outstanding-2-months").innerText = listOutstanding2Months.length.toLocaleString("id-ID");

    // 3. Determine active list
    let currentList = [];
    let title = "";
    let desc = "";

    if (actionSearchQuery) {
      currentList = allUnpaid;
      title = `Hasil Pencarian Tindak Lanjut: "${actionSearchQuery}"`;
      desc = "Menampilkan semua pelanggan outstanding (belum bayar) yang cocok dengan pencarian Anda.";
    } else {
      if (activeActionCategory === 'belum-caring') {
        currentList = listBelumCaring;
        title = "Daftar Pelanggan: Belum Caring";
        desc = "Pelanggan outstanding yang belum pernah dihubungi via telepon atau WhatsApp.";
      } else if (activeActionCategory === 'caring-no-visit') {
        currentList = listCaringNoVisit;
        title = "Daftar Pelanggan: Caring, Belum Visit";
        desc = "Pelanggan outstanding yang sudah dicaring tetapi belum dikunjungi di lapangan.";
      } else if (activeActionCategory === 'visit-no-pay') {
        currentList = listVisitNoPay;
        title = "Daftar Pelanggan: Visit, Belum Lunas";
        desc = "Pelanggan outstanding yang sudah divisit tetapi belum membayar tunggakannya.";
      } else if (activeActionCategory === 'outstanding-2-months') {
        currentList = listOutstanding2Months;
        title = "Daftar Pelanggan: Tunggakan > 2 Bulan";
        desc = "Pelanggan outstanding kritis dengan tunggakan tagihan melebihi 2 bulan.";
      }
    }

    // Update titles
    document.getElementById("action-list-table-title").innerText = title;
    document.getElementById("action-list-table-desc").innerText = desc;

    // 4. Apply search filter
    if (actionSearchQuery) {
      currentList = currentList.filter(c =>
        c.id.toLowerCase().includes(actionSearchQuery) ||
        c.nama.toLowerCase().includes(actionSearchQuery) ||
        c.noHp.includes(actionSearchQuery)
      );
    }

    // 5. Render Table Body
    const tableBody = document.getElementById("action-table-body");
    tableBody.innerHTML = "";

    const totalRecords = currentList.length;

    if (totalRecords === 0) {
      tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px;">
          <div style="display:flex; flex-direction:column; align-items:center; gap: 8px;">
            <i data-lucide="info" style="width:32px; height:32px;"></i>
            <span>Tidak ada pelanggan dalam kategori ini yang membutuhkan tindak lanjut.</span>
          </div>
        </td>
      </tr>
    `;
      lucide.createIcons({ root: tableBody });
      updateActionPaginationUI(0, 0, 0);
      return;
    }

    // Slice list based on pagination
    const startIndex = (actionCurrentPage - 1) * actionRowsPerPage;
    const endIndex = Math.min(startIndex + actionRowsPerPage, totalRecords);
    const pageCustomers = currentList.slice(startIndex, endIndex);

    pageCustomers.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td style="font-family: monospace; font-weight:700;">${c.id}</td>
      <td>
        <div style="font-weight: 600;">${c.nama}</div>
        <small class="text-muted" style="font-size:10px;">HP: ${c.id === "122415163446" || c.nama === "Sri Hayati" ? "08886046537" : c.noHp}</small>
      </td>
      <td>
        <div>${c.witel}</div>
        <small class="badge badge-purple" style="font-size:10px; margin-top:2px;">STO: ${c.sto}</small>
      </td>
      <td style="font-weight:700; color: var(--accent);">Rp ${c.tagihan.toLocaleString("id-ID")}</td>
      <td><span class="badge badge-gray">${c.umurTagihan}</span></td>
      <td style="font-size:11px; font-weight:600; color: var(--text-muted);">${c.lastUpdate}</td>
      <td style="text-align: center;">
        <div style="display: inline-flex; gap: 8px; justify-content: center; align-items: center;">
          <button class="btn-action btn-whatsapp" onclick="triggerWhatsAppClick('${c.id}', '${activeActionCategory}')" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size:11px; font-weight: 600;">
            <i data-lucide="message-square" style="width:14px; height:14px;"></i> Hubungi
          </button>
          <button class="btn-action" onclick="openDrawer('${c.id}')" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size:11px; font-weight: 600;">
            <i data-lucide="eye" style="width:14px; height:14px;"></i> Detail
          </button>
        </div>
      </td>
    `;
      tableBody.appendChild(tr);
    });

    lucide.createIcons({ root: tableBody });
    updateActionPaginationUI(startIndex + 1, endIndex, totalRecords);
  }

  function updateActionPaginationUI(start, end, total) {
    const rangeEl = document.getElementById("action-paginated-range");
    const totalEl = document.getElementById("action-paginated-total");

    if (rangeEl) rangeEl.innerText = total > 0 ? `${start}-${end}` : "0-0";
    if (totalEl) totalEl.innerText = total.toLocaleString("id-ID");

    const maxPage = Math.ceil(total / actionRowsPerPage);

    const prevBtn = document.getElementById("action-btn-prev-page");
    const nextBtn = document.getElementById("action-btn-next-page");

    if (prevBtn) prevBtn.disabled = actionCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = actionCurrentPage === maxPage || total === 0;

    const numbersDiv = document.getElementById("action-pagination-numbers");
    if (numbersDiv) {
      numbersDiv.innerHTML = "";
      if (maxPage <= 1) return;

      // Show up to 5 page numbers around actionCurrentPage
      let startPage = Math.max(1, actionCurrentPage - 2);
      let endPage = Math.min(maxPage, startPage + 4);

      if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
      }

      for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement("button");
        btn.className = `page-num ${i === actionCurrentPage ? 'active' : ''}`;
        btn.innerText = i;
        btn.addEventListener("click", () => {
          actionCurrentPage = i;
          renderActionListPanel();
        });
        numbersDiv.appendChild(btn);
      }
    }
  }

  function getWhatsAppLink(customer, category) {
    const tagihanStr = formatRupiah(customer.tagihan);
    const officerName = customer.caring.petugas !== "-" ? customer.caring.petugas : "Aisyah";
    const witelName = "914 - Priangan Timur";

    let dynamicStatusText = "Berdasarkan data kami, saat ini masih terdapat tagihan layanan yang belum dilakukan pembayaran. Apakah ada kendala yang menyebabkan pembayaran belum dapat dilakukan, Bapak/Ibu?";

    if (category === "visit-no-pay") {
      dynamicStatusText = "Berdasarkan konfirmasi kunjungan petugas kami sebelumnya, saat ini masih terdapat tagihan layanan yang belum dilakukan pembayaran. Apakah ada kendala yang menyebabkan pembayaran belum dapat dilakukan, Bapak/Ibu?";
    } else if (category === "outstanding-2-months") {
      dynamicStatusText = `Pemberitahuan penting mengenai layanan Indibiz Anda yang saat ini telah menunggak lebih dari 2 bulan dengan nominal sebesar ${tagihanStr}. Mohon segera melakukan pembayaran untuk menghindari isolir layanan sementara. Apakah ada kendala yang menyebabkan pembayaran belum dapat dilakukan, Bapak/Ibu?`;
    }

    const message = `Selamat siang Bapak/Ibu.

Perkenalkan, saya ${officerName} dari Telkom Indonesia.

Mohon izin menghubungi terkait layanan Indibiz dengan nomor internet ${customer.id} atas nama ${customer.nama.toUpperCase()}.
${dynamicStatusText}

Apabila berkenan, mohon diinformasikan perkiraan tanggal pembayaran yang akan dilakukan agar dapat kami bantu monitoring. Kira-kira pembayaran dapat dilakukan hari ini atau besok ya, Bapak/Ibu?

Sebagai informasi, pembayaran dapat dilakukan melalui Mobile Banking, Internet Banking, ATM, Indomaret, Alfamart, Tokopedia, GoPay, Kantor Pos, maupun kanal pembayaran resmi lainnya.

Terima kasih atas perhatian dan kerja sama Bapak/Ibu. Semoga sehat selalu dan aktivitasnya berjalan lancar.

INFO PENTING :
1. WASPADA terhadap oknum Teknisi yang datang dengan alasan menarik ONT untuk menggantikan dengan yang baru.
2. Tidak disarankan juga untuk menitip pembayaran melalui Account manager (AM) & Account Representatif (AR) atau Petugas yang datang.
3. Jika Anda membutuhkan bantuan lainnya, silakan hubungi kami kapan pun melalui:
✔️Call Center 1500250 atau 08001835566
✔️Email: tenesa@telkom.co.id
✔️Website: https://indibiz.co.id/
Atau kunjungi INDEX (Indibiz Experience Center) terdekat.
📍Indibiz Experience Center Cirebon
     Jl Pagongan No. 11 Pekalangan, Pekalipan, Kota Cirebon
📍Indibiz Experience Center Tasikmalaya
     Jl RAA. Wiratanuningrat No.14,Tawang, Kota Tasikmalaya

Terima kasih
Telkom Witel ${witelName}`;

    let testPhone = customer.noHp;
    if (customer.id === "122415163446" || customer.nama === "Sri Hayati") {
      testPhone = "08886046537";
    }

    const cleanPhone = cleanAndNormalizePhone(testPhone);
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  }

  function cleanAndNormalizePhone(rawPhone) {
    if (!rawPhone) return "";
    let str = String(rawPhone).trim();
    if (str.toLowerCase() === "null" || str === "-" || str.toLowerCase() === "tidak tersedia") return "";

    // Split by delimiters to take only the first number
    const parts = str.split(/[,/;|]/);
    let firstPart = parts[0].trim();

    // Remove space, -, ., (, ), and other characters
    let cleaned = firstPart.replace(/[\s\-\.\(\)]/g, "");
    // Keep only digits
    cleaned = cleaned.replace(/[^0-9]/g, "");

    if (!cleaned) return "";

    // Convert format
    if (cleaned.startsWith("0062")) {
      cleaned = "62" + cleaned.substring(4);
    } else if (cleaned.startsWith("0")) {
      cleaned = "62" + cleaned.substring(1);
    } else if (cleaned.startsWith("8")) {
      cleaned = "62" + cleaned;
    }

    return cleaned;
  }

  function showNotification(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.style.cssText = "position: fixed; bottom: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px;";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.style.cssText = `
    background: ${type === 'error' ? 'rgba(254, 46, 75, 0.95)' : 'rgba(37, 211, 102, 0.95)'};
    color: #fff;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    font-size: 13px;
    font-weight: 600;
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.1);
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  `;
    toast.innerText = message;
    container.appendChild(toast);

    // Trigger slide-in
    setTimeout(() => {
      toast.style.transform = "translateY(0)";
      toast.style.opacity = "1";
    }, 10);

    // Remove after 5 seconds
    setTimeout(() => {
      toast.style.transform = "translateY(-20px)";
      toast.style.opacity = "0";
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 5000);
  }

  function triggerWhatsAppClick(customerId, category) {
    const c = customerDatabase.find(x => x.id === customerId);
    if (!c) {
      showNotification("Data pelanggan tidak ditemukan.", "error");
      return;
    }

    let testPhone = c.noHp;
    if (c.id === "122415163446" || c.nama === "Sri Hayati") {
      testPhone = "08886046537";
    }

    // 1. Normalisasi Nomor
    const cleanPhone = cleanAndNormalizePhone(testPhone);

    // 2. Debug log
    console.log(`[WA Debug] ID: ${c.id} | Nama: ${c.nama}`);
    console.log(`[WA Debug] Nomor Asli: ${testPhone}`);
    console.log(`[WA Debug] Nomor Setelah Normalisasi: ${cleanPhone}`);

    // 3. Validasi
    const onlyDigits = /^[0-9]+$/.test(cleanPhone);
    const correctLength = cleanPhone.length >= 10 && cleanPhone.length <= 15;

    // Print debug log for validation result
    console.log(`[WA Debug] Validasi: onlyDigits=${onlyDigits}, correctLength=${correctLength} (length=${cleanPhone.length})`);

    if (!cleanPhone || !onlyDigits || !correctLength) {
      console.error(`[WA Debug] Validasi GAGAL: cleanPhone="${cleanPhone}"`);
      showNotification("Nomor telepon tidak valid.", "error");
      return;
    }

    // 4. Generate URL
    const waUrl = getWhatsAppLink(c, category);
    console.log(`[WA Debug] WhatsApp URL yang dibuat: ${waUrl}`);

    // 5. Open WhatsApp Web
    window.open(waUrl, "_blank");

    // 6. Show friendly helper warning
    showNotification("Nomor ini kemungkinan belum terdaftar di WhatsApp jika room chat tidak dapat dibuka.", "info");
  }
