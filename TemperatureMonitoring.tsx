import React, { useState, useEffect, useMemo, useRef } from "react";
import { collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import { db, auth } from "./firebase";
import { User as FirebaseUser } from "firebase/auth";
import {
  Thermometer,
  Clock,
  User,
  MapPin,
  AlertCircle,
  CheckCircle,
  Search,
  Filter,
  Calendar,
  X,
  Plus,
  Trash2,
  ClipboardList,
  AlertTriangle
} from "lucide-react";

// --- Types ---
export interface TemperatureLog {
  id?: string;
  location: string;
  timestamp: string;
  roomTemp: number;
  fridgeTemp: number;
  notes?: string;
  officerName: string;
  authorUID: string;
  createdAt?: any;
}

interface TemperatureMonitoringProps {
  user: FirebaseUser;
  isAdminUser: boolean;
  locations: string[];
  pharmacists: string[];
  showNotification: (msg: string, type: 'success' | 'error') => void;
  getJakartaDateTime: () => string;
}

export const TemperatureMonitoring: React.FC<TemperatureMonitoringProps> = ({
  user,
  isAdminUser,
  locations,
  pharmacists,
  showNotification,
  getJakartaDateTime
}) => {
  // Logs state
  const [logs, setLogs] = useState<TemperatureLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logToDelete, setLogToDelete] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    location: "",
    timestamp: getJakartaDateTime(),
    roomTemp: "",
    fridgeTemp: "",
    notes: "",
    officerName: ""
  });

  // Pharmacist suggestion autocomplete state
  const [showOfficerSuggestions, setShowOfficerSuggestions] = useState(false);
  const [selectedOfficerIndex, setSelectedOfficerIndex] = useState(-1);
  const officerInputRef = useRef<HTMLDivElement>(null);

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [startDate, setStartDate] = useState(() => {
    try {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return "";
    }
  });
  const [endDate, setEndDate] = useState("");

  // Graph state variables
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [historyMode, setHistoryMode] = useState<"graph" | "cards">("graph");

  // Setup click outside listener for officer suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (officerInputRef.current && !officerInputRef.current.contains(event.target as Node)) {
        setShowOfficerSuggestions(false);
        setSelectedOfficerIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch log history in real-time
  useEffect(() => {
    const q = query(collection(db, 'temperatureLogs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedLogs = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as TemperatureLog[];
      setLogs(fetchedLogs);
      setIsLoading(false);
    }, (error) => {
      console.error("Firestore listening error:", error);
      showNotification("Gagal memuat riwayat suhu dari database", "error");
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter pharmacists logic
  const filteredPharmacists = useMemo(() => {
    return pharmacists.filter(name =>
      name.toLowerCase().includes(formData.officerName.toLowerCase())
    );
  }, [pharmacists, formData.officerName]);

  // Handle keys inside officer input autocomplete
  const handleOfficerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showOfficerSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedOfficerIndex(prev => (prev + 1) % (filteredPharmacists.length || 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedOfficerIndex(prev => (prev - 1 + (filteredPharmacists.length || 1)) % (filteredPharmacists.length || 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredPharmacists.length > 0) {
          const finalIndex = selectedOfficerIndex >= 0 && selectedOfficerIndex < filteredPharmacists.length 
            ? selectedOfficerIndex 
            : 0;
          setFormData(prev => ({ ...prev, officerName: filteredPharmacists[finalIndex] }));
          setShowOfficerSuggestions(false);
          setSelectedOfficerIndex(-1);
        }
        break;
      case 'Escape':
        setShowOfficerSuggestions(false);
        setSelectedOfficerIndex(-1);
        break;
    }
  };

  // Form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Save temperature log entry
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const missingFields: string[] = [];
    if (!formData.location) missingFields.push("Lokasi");
    if (!formData.timestamp) missingFields.push("Tanggal & Waktu");
    if (formData.roomTemp === "") missingFields.push("Suhu Ruangan");
    if (formData.fridgeTemp === "") missingFields.push("Suhu Terkontrol");
    if (!formData.officerName.trim()) missingFields.push("Nama Petugas");

    if (missingFields.length > 0) {
      showNotification(`Formulir tidak lengkap! Isian wajib: ${missingFields.join(", ")}`, "error");
      return;
    }

    setIsSubmitting(true);
    try {
      const rTemp = parseFloat(formData.roomTemp);
      const fTemp = parseFloat(formData.fridgeTemp);

      if (isNaN(rTemp) || rTemp < -50 || rTemp > 100) {
        showNotification("Suhu ruangan tidak valid atau di luar jangkauan!", "error");
        setIsSubmitting(false);
        return;
      }
      if (isNaN(fTemp) || fTemp < -50 || fTemp > 100) {
        showNotification("Suhu terkontrol tidak valid atau di luar jangkauan!", "error");
        setIsSubmitting(false);
        return;
      }

      const logPayload = {
        location: formData.location,
        timestamp: formData.timestamp,
        roomTemp: rTemp,
        fridgeTemp: fTemp,
        notes: formData.notes.trim() || "",
        officerName: formData.officerName.trim(),
        authorUID: user.uid,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'temperatureLogs'), logPayload);

      showNotification("Log suhu berhasil disimpan", "success");
      setFormData({
        location: "",
        timestamp: getJakartaDateTime(),
        roomTemp: "",
        fridgeTemp: "",
        notes: "",
        officerName: ""
      });
    } catch (error) {
      console.error("Save temperature log error:", error);
      showNotification("Gagal menyimpan log suhu ke database", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete temperature log
  const handleDeleteLog = async () => {
    if (!logToDelete) return;
    try {
      await deleteDoc(doc(db, 'temperatureLogs', logToDelete));
      showNotification("Log suhu berhasil dihapus", "success");
    } catch (error) {
      console.error("Delete temperature log error:", error);
      showNotification("Gagal menghapus log dari database", "error");
    } finally {
      setLogToDelete(null);
    }
  };

  // Temperature ranges validations
  const isRoomTempNormal = (temp: number) => temp >= 15 && temp <= 25;
  const isFridgeTempNormal = (temp: number) => temp >= 2 && temp <= 8;

  // Realtime safety verification helpers
  const currentRoomTempNum = parseFloat(formData.roomTemp);
  const currentFridgeTempNum = parseFloat(formData.fridgeTemp);

  // Memoized filtered history logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // search filter
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        log.officerName.toLowerCase().includes(searchLower) ||
        log.location.toLowerCase().includes(searchLower) ||
        (log.notes && log.notes.toLowerCase().includes(searchLower));

      // location filter
      const matchesLocation = !locationFilter || log.location === locationFilter;

      // date filters
      const logDateOnly = log.timestamp.substring(0, 10); // "YYYY-MM-DD"
      const matchesStart = !startDate || logDateOnly >= startDate;
      const matchesEnd = !endDate || logDateOnly <= endDate;

      return matchesSearch && matchesLocation && matchesStart && matchesEnd;
    });
  }, [logs, searchTerm, locationFilter, startDate, endDate]);

  // Chronological sort of logs for the graph
  const chronologicalLogs = useMemo(() => {
    return [...filteredLogs].reverse();
  }, [filteredLogs]);

  // Chart config
  const chartWidth = 650;
  const chartHeight = 320;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 40;

  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  // Let's find dynamically min & max
  const { minT, maxT } = useMemo(() => {
    if (chronologicalLogs.length === 0) return { minT: 0, maxT: 35 };
    let min = 0;
    let max = 30;
    chronologicalLogs.forEach(l => {
      if (l.roomTemp < min) min = Math.floor(l.roomTemp);
      if (l.fridgeTemp < min) min = Math.floor(l.fridgeTemp);
      if (l.roomTemp > max) max = Math.ceil(l.roomTemp);
      if (l.fridgeTemp > max) max = Math.ceil(l.fridgeTemp);
    });
    return { minT: Math.max(-10, min), maxT: Math.min(50, max + 2) };
  }, [chronologicalLogs]);

  const getX = (index: number) => {
    if (chronologicalLogs.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (index / (chronologicalLogs.length - 1)) * plotWidth;
  };

  const getY = (temp: number) => {
    const range = maxT - minT || 1;
    return paddingTop + plotHeight - ((temp - minT) / range) * plotHeight;
  };

  const gridT = useMemo(() => {
    const range = maxT - minT;
    const steps = 5;
    const stepVal = range / steps;
    const arr = [];
    for (let i = 0; i <= steps; i++) {
      arr.push(Math.round((minT + stepVal * i) * 10) / 10);
    }
    return arr;
  }, [minT, maxT]);

  // Safe zones
  const fridgeBand = useMemo(() => {
    const topBand = getY(8);
    const bottomBand = getY(2);
    return {
      y: Math.max(paddingTop, topBand),
      h: Math.min(plotHeight, bottomBand - topBand)
    };
  }, [minT, maxT]);

  const roomBand = useMemo(() => {
    const topBand = getY(25);
    const bottomBand = getY(15);
    return {
      y: Math.max(paddingTop, topBand),
      h: Math.min(plotHeight, bottomBand - topBand)
    };
  }, [minT, maxT]);

  // Statistics calculation
  const stats = useMemo(() => {
    if (logs.length === 0) return { total: 0, oosCount: 0, optimalPercent: 100 };
    let oosCount = 0;
    logs.forEach(log => {
      if (!isRoomTempNormal(log.roomTemp) || !isFridgeTempNormal(log.fridgeTemp)) {
        oosCount++;
      }
    });
    const optimalPercent = Math.round(((logs.length - oosCount) / logs.length) * 100);
    return { total: logs.length, oosCount, optimalPercent };
  }, [logs]);

  // Format date time helper
  const formatDateTimeDisplay = (dtStr: string) => {
    if (!dtStr) return '-';
    try {
      const date = new Date(dtStr);
      if (isNaN(date.getTime())) return dtStr;
      const d = String(date.getDate()).padStart(2, '0');
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const y = date.getFullYear();
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return `${d}/${m}/${y}, ${hh}:${mm}`;
    } catch {
      return dtStr;
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Visual Banner Header */}
      <div className="bg-gradient-to-r from-red-50 to-orange-50 border-y border-red-100 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-red-950 flex items-center">
            <Thermometer className="w-6 h-6 mr-2 text-red-600 animate-pulse" />
            Monitoring Suhu Kamar Obat & Refrigerator
          </h2>
          <p className="text-sm text-red-800/80 mt-1">
            Standar suhu ruang penyimpanan: <strong>15 - 25 °C</strong> | Refrigerator obat: <strong>2 - 8 °C</strong>
          </p>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div className="bg-white/80 backdrop-blur-sm border border-red-100 rounded-xl px-4 py-2 shadow-xs text-center min-w-[100px]">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Total Log</p>
            <p className="text-xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm border border-red-100 rounded-xl px-4 py-2 shadow-xs text-center min-w-[124px]">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold text-center">Suhu Sesuai</p>
            <p className={`text-xl font-bold ${stats.optimalPercent === 100 ? 'text-green-600' : 'text-orange-600'}`}>
              {stats.optimalPercent}%
            </p>
          </div>
          {stats.oosCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 shadow-xs text-center min-w-[124px]">
              <p className="text-[10px] uppercase tracking-wider text-red-700 font-semibold">Penyimpangan</p>
              <p className="text-xl font-bold text-red-600">{stats.oosCount} Hari</p>
            </div>
          )}
        </div>
      </div>

      {/* Form Container (Full Width / Grid layout for fields inside) */}
      <div id="temperature-entry-card" className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-base font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100 uppercase tracking-wider">
          Catat Suhu Baru
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Lokasi */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Lokasi Suhu Diukur</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <select
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-2 border bg-white"
                >
                  <option value="">-- Pilih Lokasi --</option>
                  {locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tanggal & Waktu */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Tanggal & Waktu Ukur</label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="datetime-local"
                  name="timestamp"
                  value={formData.timestamp}
                  onChange={handleInputChange}
                  className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-2 border"
                />
              </div>
            </div>

            {/* Petugas Autocomplete */}
            <div className="relative" ref={officerInputRef}>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Nama Petugas Pemeriksa</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  name="officerName"
                  placeholder="Cari atau ketik nama petugas..."
                  value={formData.officerName}
                  onChange={handleInputChange}
                   onKeyDown={handleOfficerKeyDown}
                  onFocus={() => setShowOfficerSuggestions(true)}
                  className="w-full pl-9 pr-8 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-2 border bg-white"
                  autoComplete="off"
                />
                {formData.officerName && (
                  <button
                    type="button"
                    onClick={() => setFormData(p => ({ ...p, officerName: "" }))}
                    className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {showOfficerSuggestions && filteredPharmacists.length > 0 && (
                <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md bg-white border border-gray-100 py-1 text-sm shadow-xl focus:outline-none">
                  {filteredPharmacists.map((name, idx) => (
                    <li
                      key={name}
                      onClick={() => {
                        setFormData(prev => ({ ...prev, officerName: name }));
                        setShowOfficerSuggestions(false);
                        setSelectedOfficerIndex(-1);
                      }}
                      onMouseEnter={() => setSelectedOfficerIndex(idx)}
                      className={`cursor-pointer select-none py-2 pl-3 pr-9 transition-colors text-gray-900 ${
                        idx === selectedOfficerIndex ? "bg-red-50 text-red-700 font-medium" : "hover:bg-gray-50"
                      }`}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Suhu Ruangan (15 - 25 °C) */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Suhu Ruangan (°C)</label>
              <div className="relative">
                <Thermometer className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="number"
                  step="0.1"
                  name="roomTemp"
                  placeholder="Rentang: 15 - 25 °C"
                  value={formData.roomTemp}
                  onChange={handleInputChange}
                  className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-2 border font-mono"
                />
              </div>
              {/* Live Validation Pill */}
              {!isNaN(currentRoomTempNum) && formData.roomTemp !== "" && (
                <div className="mt-1 flex items-center">
                  {isRoomTempNormal(currentRoomTempNum) ? (
                    <span className="inline-flex items-center text-[11px] font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">
                      <CheckCircle className="w-3 h-3 mr-1 text-green-500" /> Suhu Ruang Optimal (15-25 °C)
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-[11px] font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded">
                      <AlertTriangle className="w-3 h-3 mr-1 text-red-500" /> Penyimpangan Suhu Ruangan!
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Suhu Refrigerator (2 - 8 °C) */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Suhu Refrigerator / Terkontrol (°C)</label>
              <div className="relative">
                <Thermometer className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="number"
                  step="0.1"
                  name="fridgeTemp"
                  placeholder="Rentang: 2 - 8 °C"
                  value={formData.fridgeTemp}
                  onChange={handleInputChange}
                  className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-2 border font-mono"
                />
              </div>
              {/* Live Validation Pill */}
              {!isNaN(currentFridgeTempNum) && formData.fridgeTemp !== "" && (
                <div className="mt-1 flex items-center">
                  {isFridgeTempNormal(currentFridgeTempNum) ? (
                    <span className="inline-flex items-center text-[11px] font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">
                      <CheckCircle className="w-3 h-3 mr-1 text-green-500" /> Suhu Refrg. Optimal (2-8 °C)
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-[11px] font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded">
                      <AlertTriangle className="w-3 h-3 mr-1 text-red-500" /> Penyimpangan Refrigerator!
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Keterangan */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Keterangan / Catatan Tindakan</label>
              <textarea
                name="notes"
                rows={1}
                placeholder="Contoh: AC dimatikan sementara, dsb."
                value={formData.notes}
                onChange={handleInputChange}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-2 border"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-8 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 shadow-sm transition-colors disabled:bg-gray-400"
            >
              {isSubmitting ? "Menyimpan..." : "Simpan Log Pemantauan"}
            </button>
          </div>
        </form>
      </div>

      {/* History List/Graph Container */}
      <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-2">
            <h3 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider flex items-center">
              <ClipboardList className="w-5 h-5 mr-1.5 text-red-600" />
              Riwayat & Tren Suhu
            </h3>
            
            {/* Mode Switcher */}
            <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-semibold">
              <button
                type="button"
                onClick={() => setHistoryMode("graph")}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  historyMode === "graph" ? "bg-white text-red-700 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                Grafik Tren Suhu
              </button>
              <button
                type="button"
                onClick={() => setHistoryMode("cards")}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  historyMode === "cards" ? "bg-white text-red-700 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Tabel Catatan ({filteredLogs.length})
              </button>
            </div>
          </div>

          {/* Search, Filter Tools */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Cari petugas, lokasi..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-1.5 border"
                />
              </div>

              <div>
                <select
                  value={locationFilter}
                  onChange={e => setLocationFilter(e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-1.5 border bg-white"
                >
                  <option value="">Semua Lokasi</option>
                  {locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <Calendar className="absolute left-3 top-2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-1.5 border"
                  title="Tanggal Mulai"
                />
              </div>

              <div className="relative">
                <Calendar className="absolute left-3 top-2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm p-1.5 border"
                  title="Tanggal Selesai"
                />
              </div>
            </div>
          </div>

          {/* Logs / Graphs Content Area */}
          {isLoading ? (
            <div className="text-center py-20 bg-white border border-gray-200 rounded-xl">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto"></div>
              <p className="text-sm text-gray-500 mt-2">Sinkronisasi data suhu...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-20 bg-white border border-gray-200 rounded-xl space-y-3">
              <ClipboardList className="w-10 h-10 text-gray-200 mx-auto" />
              <p className="text-gray-500 text-sm font-medium">Belum ada log pemantauan suhu yang sesuai</p>
            </div>
          ) : historyMode === "graph" ? (
            /* INTERACTIVE GRAPH VIEW */
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">Visualisasi Tren Pemantauan</h4>
                  <p className="text-[10px] text-gray-500 font-medium">Klik pada titik data atau gerakkan kursor untuk memeriksa detail suhu</p>
                </div>

                {/* Legend */}
                <div className="flex items-center space-x-4 text-[11px] font-semibold text-gray-600">
                  <div className="flex items-center">
                    <span className="w-3 h-3 rounded-full bg-orange-600 mr-1.5 inline-block"></span>
                    Suhu Ruangan (15-25°C)
                  </div>
                  <div className="flex items-center">
                    <span className="w-3 h-3 rounded-full bg-sky-500 mr-1.5 inline-block"></span>
                    Suhu Refrigerator (2-8°C)
                  </div>
                </div>
              </div>

              {/* responsive SVG container */}
              <div className="relative overflow-hidden border border-gray-100 rounded-lg bg-gray-50/50 p-2">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-auto overflow-visible animate-fade-in"
                >
                  <defs>
                    <linearGradient id="fridgeG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="roomG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ea580c" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="#ea580c" stopOpacity="0" />
                    </linearGradient>
                  </defs>

                  {/* Background Threshold Bands */}
                  {/* Refrig band list (2-8) */}
                  <rect
                    x={paddingLeft}
                    y={fridgeBand.y}
                    width={plotWidth}
                    height={fridgeBand.h}
                    fill="#0284c7"
                    fillOpacity="0.04"
                  />
                  {/* Room band list (15-25) */}
                  <rect
                    x={paddingLeft}
                    y={roomBand.y}
                    width={plotWidth}
                    height={roomBand.h}
                    fill="#15803d"
                    fillOpacity="0.03"
                  />

                  {/* Grid Lines */}
                  {gridT.map((t, idx) => (
                    <g key={idx}>
                      <line
                        x1={paddingLeft}
                        y1={getY(t)}
                        x2={paddingLeft + plotWidth}
                        y2={getY(t)}
                        stroke="#e2e8f0"
                        strokeWidth="0.75"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={paddingLeft - 8}
                        y={getY(t) + 3}
                        className="text-[9px] font-mono fill-gray-400 font-bold"
                        textAnchor="end"
                      >
                        {t}°C
                      </text>
                    </g>
                  ))}

                  {/* Range Boundaries labels */}
                  <line
                    x1={paddingLeft}
                    y1={getY(8)}
                    x2={paddingLeft + plotWidth}
                    y2={getY(8)}
                    stroke="#0284c7"
                    strokeWidth="1"
                    strokeOpacity="0.25"
                    strokeDasharray="2 1"
                  />
                  <line
                    x1={paddingLeft}
                    y1={getY(2)}
                    x2={paddingLeft + plotWidth}
                    y2={getY(2)}
                    stroke="#0284c7"
                    strokeWidth="1"
                    strokeOpacity="0.25"
                    strokeDasharray="2 1"
                  />
                  <line
                    x1={paddingLeft}
                    y1={getY(25)}
                    x2={paddingLeft + plotWidth}
                    y2={getY(25)}
                    stroke="#ea580c"
                    strokeWidth="1"
                    strokeOpacity="0.2"
                    strokeDasharray="2 1"
                  />
                  <line
                    x1={paddingLeft}
                    y1={getY(15)}
                    x2={paddingLeft + plotWidth}
                    y2={getY(15)}
                    stroke="#ea580c"
                    strokeWidth="1"
                    strokeOpacity="0.2"
                    strokeDasharray="2 1"
                  />

                  {/* X Axis division markers */}
                  {chronologicalLogs.map((log, idx) => {
                    const showLabel = chronologicalLogs.length <= 8 || idx % Math.ceil(chronologicalLogs.length / 6) === 0;
                    return (
                      <g key={idx}>
                        <line
                          x1={getX(idx)}
                          y1={paddingTop + plotHeight}
                          x2={getX(idx)}
                          y2={paddingTop + plotHeight + 4}
                          stroke="#cbd5e1"
                          strokeWidth="1"
                        />
                        {showLabel && (
                          <text
                            x={getX(idx)}
                            y={paddingTop + plotHeight + 15}
                            className="text-[8px] font-semibold fill-gray-400 select-none"
                            textAnchor="middle"
                          >
                            {log.timestamp.substring(8, 10)}/{log.timestamp.substring(5, 7)}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Trend Area Polygon Shading (if has > 1 point) */}
                  {chronologicalLogs.length > 1 && (
                    <>
                      {/* Fridge Area under line */}
                      <polygon
                        points={`${paddingLeft},${paddingTop + plotHeight} ${chronologicalLogs.map((log, idx) => `${getX(idx)},${getY(log.fridgeTemp)}`).join(' ')} ${paddingLeft + plotWidth},${paddingTop + plotHeight}`}
                        fill="url(#fridgeG)"
                      />
                      {/* Room Area under line */}
                      <polygon
                        points={`${paddingLeft},${paddingTop + plotHeight} ${chronologicalLogs.map((log, idx) => `${getX(idx)},${getY(log.roomTemp)}`).join(' ')} ${paddingLeft + plotWidth},${paddingTop + plotHeight}`}
                        fill="url(#roomG)"
                      />
                    </>
                  )}

                  {/* Draw main trend lines */}
                  {chronologicalLogs.length > 1 ? (
                    <>
                      {/* Refrigerator Temp Line */}
                      <path
                        d={`M ${chronologicalLogs.map((log, idx) => `${getX(idx)} ${getY(log.fridgeTemp)}`).join(' L ')}`}
                        fill="none"
                        stroke="#0ea5e9"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Room Temp Line */}
                      <path
                        d={`M ${chronologicalLogs.map((log, idx) => `${getX(idx)} ${getY(log.roomTemp)}`).join(' L ')}`}
                        fill="none"
                        stroke="#ea580c"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </>
                  ) : null}

                  {/* Interactive Vertical Highlight Grid */}
                  {(hoveredIdx !== null || selectedIdx !== null) && (
                    (() => {
                      const activeIdx = hoveredIdx !== null ? hoveredIdx : selectedIdx;
                      if (activeIdx !== null && activeIdx >= 0 && activeIdx < chronologicalLogs.length) {
                        const log = chronologicalLogs[activeIdx];
                        return (
                          <g>
                            {/* Vertical Line */}
                            <line
                              x1={getX(activeIdx)}
                              y1={paddingTop}
                              x2={getX(activeIdx)}
                              y2={paddingTop + plotHeight}
                              stroke="#94a3b8"
                              strokeWidth="1"
                              strokeDasharray="4 3"
                            />
                            {/* Refrigerator value glowing circle */}
                            <circle
                              cx={getX(activeIdx)}
                              cy={getY(log.fridgeTemp)}
                              r="8"
                              fill="#0ea5e9"
                              fillOpacity="0.25"
                              className="animate-pulse"
                            />
                            <circle
                              cx={getX(activeIdx)}
                              cy={getY(log.fridgeTemp)}
                              r="4"
                              fill="#0ea5e9"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                            {/* Room value glowing circle */}
                            <circle
                              cx={getX(activeIdx)}
                              cy={getY(log.roomTemp)}
                              r="8"
                              fill="#ea580c"
                              fillOpacity="0.2"
                              className="animate-pulse"
                            />
                            <circle
                              cx={getX(activeIdx)}
                              cy={getY(log.roomTemp)}
                              r="4"
                              fill="#ea580c"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                          </g>
                        );
                      }
                      return null;
                    })()
                  )}

                  {/* Standard Static Dots */}
                  {chronologicalLogs.map((log, idx) => {
                    const rNormal = isRoomTempNormal(log.roomTemp);
                    const fNormal = isFridgeTempNormal(log.fridgeTemp);
                    return (
                      <g key={idx}>
                        {/* Fridge temp dot */}
                        <circle
                          cx={getX(idx)}
                          cy={getY(log.fridgeTemp)}
                          r="3"
                          fill={fNormal ? "#0ea5e9" : "#dc2626"}
                          stroke="#ffffff"
                          strokeWidth="1"
                        />
                        {/* Room temp dot */}
                        <circle
                          cx={getX(idx)}
                          cy={getY(log.roomTemp)}
                          r="3"
                          fill={rNormal ? "#ea580c" : "#dc2626"}
                          stroke="#ffffff"
                          strokeWidth="1"
                        />
                      </g>
                    );
                  })}

                  {/* Hotspots for hover calculation */}
                  {chronologicalLogs.map((log, idx) => {
                    const stepSize = plotWidth / Math.max(1, chronologicalLogs.length - 1);
                    const xStart = getX(idx) - stepSize / 2;
                    const widthVal = stepSize;
                    return (
                      <rect
                        key={idx}
                        x={xStart}
                        y={paddingTop}
                        width={widthVal}
                        height={plotHeight}
                        fill="transparent"
                        className="cursor-pointer opacity-0"
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        onClick={() => setSelectedIdx(idx)}
                      />
                    );
                  })}
                </svg>

                {/* Floating Tooltip matching hover */}
                {(() => {
                  const activeIdx = hoveredIdx !== null ? hoveredIdx : null;
                  if (activeIdx !== null && activeIdx >= 0 && activeIdx < chronologicalLogs.length) {
                    const log = chronologicalLogs[activeIdx];
                    const x = getX(activeIdx);
                    const y = Math.min(getY(log.roomTemp), getY(log.fridgeTemp));
                    
                    const leftPct = (x / chartWidth) * 100;
                    const topPct = (y / chartHeight) * 100;

                    const isRightSide = leftPct > 55;
                    const isTopHalf = topPct < 30;

                    return (
                      <div
                        className="absolute pointer-events-none bg-slate-900/95 text-white text-[11px] rounded-lg p-2.5 shadow-lg border border-slate-700/50 z-30 transition-all duration-150 ease-out"
                        style={{
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          transform: `translate(${isRightSide ? '-107%' : '10%'}, ${isTopHalf ? '10%' : '-100%'})`,
                          maxWidth: '190px',
                          minWidth: '150px'
                        }}
                      >
                        <p className="font-bold border-b border-white/20 pb-1 mb-1 text-[10px] text-gray-300">
                          <span className="text-white font-extrabold uppercase block truncate">{log.location}</span>
                          <span className="text-[9px] text-gray-400 font-semibold">{formatDateTimeDisplay(log.timestamp)}</span>
                        </p>
                        <div className="space-y-1 font-medium">
                          <p className="flex items-center justify-between gap-3 text-orange-300">
                            <span>Suhu Ruang:</span>
                            <span className="font-mono font-bold">{log.roomTemp.toFixed(1)}°C</span>
                          </p>
                          <p className="flex items-center justify-between gap-3 text-sky-300">
                            <span>Suhu Refrig:</span>
                            <span className="font-mono font-bold">{log.fridgeTemp.toFixed(1)}°C</span>
                          </p>
                        </div>
                        <div className="mt-1.5 pt-1.5 border-t border-white/10 text-[9px] text-gray-400 font-semibold leading-tight truncate">
                          Petugas: {log.officerName}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Point Detail Panel */}
              {(() => {
                const activeIdx = hoveredIdx !== null ? hoveredIdx : (selectedIdx !== null ? selectedIdx : chronologicalLogs.length - 1);
                if (activeIdx !== null && activeIdx >= 0 && activeIdx < chronologicalLogs.length) {
                  const log = chronologicalLogs[activeIdx];
                  const rNormal = isRoomTempNormal(log.roomTemp);
                  const fNormal = isFridgeTempNormal(log.fridgeTemp);
                  return (
                    <div className="bg-gradient-to-r from-gray-50 to-red-50/20 border border-gray-100 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-gray-805 bg-gray-100 py-0.5 px-2 rounded-full font-mono">{log.location}</span>
                          <span className="text-[10px] text-gray-400 font-bold flex items-center">
                            <Clock className="w-3.5 h-3.5 mr-0.5 text-gray-400" />
                            {formatDateTimeDisplay(log.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-center text-xs font-semibold text-gray-600">
                          <User className="w-3.5 h-3.5 mr-1 text-gray-400" />
                          Petugas: {log.officerName}
                        </div>
                        {log.notes && (
                          <div className="bg-white/80 border border-gray-100/50 rounded p-1.5 text-[10px] text-gray-500 italic mt-1 max-w-md">
                            "{log.notes}"
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2.5">
                        {/* Room Temp Card */}
                        <div className={`p-2 w-28 rounded border text-center ${
                          rNormal ? 'bg-green-50/40 border-green-100' : 'bg-red-50/40 border-red-100'
                        }`}>
                          <p className="text-[8px] font-black tracking-widest text-gray-400 uppercase leading-none">Suhu Ruang</p>
                          <p className={`text-base font-black font-mono mt-0.5 ${rNormal ? 'text-green-700' : 'text-red-700'}`}>
                            {log.roomTemp.toFixed(1)}°C
                          </p>
                          <span className={`inline-block text-[7px] font-bold px-1 py-0.2 rounded mt-1 ${
                            rNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {rNormal ? 'Sesuai' : 'Deviasi'}
                          </span>
                        </div>

                        {/* Fridge Temp Card */}
                        <div className={`p-2 w-28 rounded border text-center ${
                          fNormal ? 'bg-green-50/40 border-green-100' : 'bg-red-50/40 border-red-100'
                        }`}>
                          <p className="text-[8px] font-black tracking-widest text-gray-400 uppercase leading-none">Suhu Refrig</p>
                          <p className={`text-base font-black font-mono mt-0.5 ${fNormal ? 'text-sky-700' : 'text-red-700'}`}>
                            {log.fridgeTemp.toFixed(1)}°C
                          </p>
                          <span className={`inline-block text-[7px] font-bold px-1 py-0.2 rounded mt-1 ${
                            fNormal ? 'bg-sky-100 text-sky-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {fNormal ? 'Sesuai (2-8°)' : 'Deviasi'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          ) : (
            /* DETAILED HISTORY LIST (TABLE VIEWS) */
            <div className="space-y-3">
              {filteredLogs.map(log => {
                const roomNormal = isRoomTempNormal(log.roomTemp);
                const fridgeNormal = isFridgeTempNormal(log.fridgeTemp);
                const isNormal = roomNormal && fridgeNormal;

                return (
                  <div
                    key={log.id}
                    className={`bg-white rounded-xl border p-4 shadow-2xs hover:shadow-xs transition-all duration-150 relative flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      !isNormal ? 'border-red-200 bg-red-50/10' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* Left Meta Info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center text-xs font-bold text-red-950 bg-red-50 px-2.5 py-1 rounded-md border border-red-100">
                          <MapPin className="w-3.5 h-3.5 mr-1 text-red-600" />
                          {log.location}
                        </span>
                        <span className="inline-flex items-center text-xs text-gray-500 font-medium">
                          <Clock className="w-3.5 h-3.5 mr-1 text-gray-400" />
                          {formatDateTimeDisplay(log.timestamp)}
                        </span>
                      </div>

                      <div className="flex items-center text-xs text-gray-750 font-semibold flex-wrap gap-2">
                        <span className="inline-flex items-center text-gray-500 font-medium">
                          <User className="w-3.5 h-3.5 mr-1 text-gray-400" />
                          Petugas:
                        </span>
                        <span className="text-gray-900 bg-gray-100/80 px-2 py-0.5 rounded font-black">
                          {log.officerName}
                        </span>
                      </div>

                      {log.notes && (
                        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-2.5 leading-relaxed max-w-2xl animate-fade-in">
                          <span className="font-semibold text-gray-400 block mb-0.5 text-[10px] uppercase">Catatan:</span>
                          "{log.notes}"
                        </div>
                      )}
                    </div>

                    {/* Right Temperature metrics */}
                    <div className="flex flex-wrap items-center gap-4">
                      {/* Room temperature panel */}
                      <div className={`p-2.5 w-28 rounded-xl border text-center ${
                        roomNormal ? 'bg-green-50/45 border-green-100' : 'bg-red-50/50 border-red-100'
                      }`}>
                        <p className="text-[8px] font-black tracking-widest text-gray-400 uppercase leading-none">Suhu Ruang</p>
                        <p className={`text-base font-black font-mono mt-0.5 ${roomNormal ? 'text-green-700' : 'text-red-700'}`}>
                          {log.roomTemp.toFixed(1)}°C
                        </p>
                        <span className={`inline-block text-[8px] font-bold px-2 py-0.5 rounded-full mt-1.5 ${
                          roomNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {roomNormal ? 'Optimal' : 'Deviasi'}
                        </span>
                      </div>

                      {/* Fridge temperature panel */}
                      <div className={`p-2.5 w-28 rounded-xl border text-center ${
                        fridgeNormal ? 'bg-green-50/45 border-green-100' : 'bg-red-50/50 border-red-100'
                      }`}>
                        <p className="text-[8px] font-black tracking-widest text-gray-400 uppercase leading-none">Suhu Refrig</p>
                        <p className={`text-base font-black font-mono mt-0.5 ${fridgeNormal ? 'text-sky-700' : 'text-red-700'}`}>
                          {log.fridgeTemp.toFixed(1)}°C
                        </p>
                        <span className={`inline-block text-[8px] font-bold px-2 py-0.5 rounded-full mt-1.5 ${
                          fridgeNormal ? 'bg-sky-100 text-sky-850' : 'bg-red-100 text-red-800'
                        }`}>
                          {fridgeNormal ? '2-8°C (OK)' : 'Deviasi'}
                        </span>
                      </div>

                      {/* Delete log inside row */}
                      {(isAdminUser || user.uid === log.authorUID) && (
                        <div className="sm:pl-3 sm:border-l border-gray-100 flex items-center justify-center">
                          <button
                            onClick={() => setLogToDelete(log.id || null)}
                            className="text-gray-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition-colors"
                            title="Hapus Log"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      {/* Delete Confirmation Modal */}
      {logToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center">
            <div className="bg-red-100 p-3 rounded-full inline-block mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Hapus Catatan Suhu?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Hapus log pemantauan ini? Tindakan ini akan menghapusnya dari riwayat permanen.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setLogToDelete(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleDeleteLog}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 shadow-sm transition-colors"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
