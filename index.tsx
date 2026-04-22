import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { auth, db } from "./firebase";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, getDocFromServer, writeBatch } from "firebase/firestore";
import {
  Activity,
  Save,
  Plus,
  Trash2,
  FileText,
  Clock,
  User,
  MapPin,
  Stethoscope,
  Syringe,
  CheckCircle,
  AlertCircle,
  Sparkles,
  History,
  ClipboardList,
  Search,
  X,
  Key,
  Lock,
  Download,
  Filter,
  Calendar,
  LogOut,
  Bell,
  BellOff
} from "lucide-react";

// --- Firebase Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | undefined;
    providerInfo: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---

interface UsedItem {
  id: string;
  name: string;
  quantity: number;
  type: string; // Mengganti unit menjadi type (Jenis)
}

interface TrolleyForm {
  id: string;
  serialNumber: string;
  patientName: string;
  mrn: string; // Medical Record Number
  room: string;
  trolleyLocation: string;
  keyNumber: string;
  timestamp: string;
  doctorName: string;
  nurseName: string;
  diagnosis: string;
  items: UsedItem[];
  narrativeNotes: string;
  newKeyNumber: string;
  pharmacistName: string;
  sealTimestamp: string;
  authorUID?: string;
  createdAt?: any;
}

interface StaffMember {
  name: string;
  role: string;
}

// --- Mock Data / Constants ---

const getJakartaDateTime = () => {
  const date = new Date();
  const jakartaStr = date.toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
  const jakartaDate = new Date(jakartaStr);
  
  const year = jakartaDate.getFullYear();
  const month = String(jakartaDate.getMonth() + 1).padStart(2, '0');
  const day = String(jakartaDate.getDate()).padStart(2, '0');
  const hours = String(jakartaDate.getHours()).padStart(2, '0');
  const minutes = String(jakartaDate.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const generateSerialNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `TRL-${year}${month}${day}-${random}`;
};

const INITIAL_FORM: TrolleyForm = {
  id: "",
  serialNumber: "",
  patientName: "",
  mrn: "",
  room: "",
  trolleyLocation: "",
  keyNumber: "",
  timestamp: getJakartaDateTime(),
  doctorName: "",
  nurseName: "",
  diagnosis: "",
  items: [],
  narrativeNotes: "",
  newKeyNumber: "",
  pharmacistName: "",
  sealTimestamp: "",
};

const PHARMACISTS = [
  "WINARTI",
  "TRI WIDAYATI",
  "DESY ENDRAWATI",
  "WIYONO",
  "INDARTI DIAN PURWANI, S.Farm, Apt",
  "FEBRI PURWANTINI ANUGRAHANINGSIH, S.Si,Apt",
  "YUDHI DEWI TIMORITA",
  "KADEK SULISTIYOWATI",
  "RETNO AYU BUDININGSIH",
  "NORMA HADI UTAMI",
  "WAHID BUDI NUGROHO, S.Farm, Apt",
  "PRATIWI HENING WULANSARI, S.Farm, Apt",
  "Anafia Azzahra Pratiwi",
  "Ratri Rokhani",
  "RONA FITRIANA, A.Md.Farm",
  "YUSI NOVA RAHMAWATI, A.Md.Farm",
  "FELLA SYIFA, S.Farm, Apt",
  "ISTIANA MAHYA HANIFA, A.Md.Farm",
  "LILIS REJEKI, S.Farm, Apt",
  "MUHAMMAD IQBAL RUSHANFIKRI, S.Farm,Apt",
  "KURNIA PUTRI ANGGRAINI",
  "TIARA ANNISA ROHMAH",
  "ASTRI PANGESTUTI KARINA",
  "Rini Pramuati, S.Farm, Apt.",
  "Dyah Fatimatussholichah, S.Farm, Apt",
  "Dinda Nur Dhuhania"
];

const TROLLEY_LOCATIONS = [
  "TROLLY EMERGENCY IBS",
  "TROLLY EMERGENCY ICU",
  "TROLLY EMERGENCY IGD",
  "TROLLY EMERGENCY MCU",
  "TROLLY EMERGENCY NAKULA",
  "TROLLY EMERGENCY NICU",
  "TROLLY EMERGENCY PONEK IGD",
  "TROLLY EMERGENCY RALAN NAKULA",
  "TROLLY EMERGENCY SADEWA 1",
  "TROLLY EMERGENCY SADEWA 2",
  "TROLLY EMERGENCY SEMBODRO"
];

const COMMON_ITEMS = [
  "Aqua pro injeksi 25 ml (WFI) OBAT",
  "Dexamethason Inj 5 mg/ml OBAT",
  "Furosemide INJ 10 mg/ml @ 2 ml OBAT",
  "Valisanbe INJ 5 mg/ml (Diazepam) OBAT (P)",
  "Ca Gluconas Inj 10% OBAT (HA)",
  "Norepinephrine inj 1 mg/ml @ 4 ml OBAT (HA)",
  "Isosorbide Dinitrate (ISDN) Inj 10 mg/10 ml OBAT",
  "Dobutamine inj 50 mg/ml ampul 5 ml OBAT",
  "Ephedrine inj 50 mg/ml @1 ml (Efedrin) OBAT (HA)",
  "Atropin Sulfat Inj 0,25 mg/ml OBAT (HA)",
  "Phenytoin inj 50 mg/ml (Fenitoin) OBAT",
  "Diphenhydramin HCl Inj 10 mg/ml OBAT",
  "Epinefrin inj 1 mg/ml (Epinephrine) @1 ml OBAT (HA)",
  "Dopamin HCl inj 40 mg/ml OBAT",
  "Amiodaron inj 50 mg/ml @ 3 ml (150 mg/3 ml) OBAT (HA)",
  "Lidocaine HCl Inj 2% @2 ml OBAT (HA)",
  "D40% 25 ml OBAT (HA)",
  "Meylon 84 Inj (Natrium bikarbonat 8,4%) @25 ml OBAT (HA)",
  "MgSO4 40% inj (Magnesium sulfat) @25 ml OBAT (HA)",
  "Infuset Anak BMHP",
  "Masker Non Rebreather Dewasa BMHP",
  "Nasal Canul O2 (Selang O2) anak / pediatric / child BMHP",
  "Masker Non Rebreather Anak BMHP",
  "Suction Cath+Finger 12 BMHP",
  "Suction Cath+Finger 14 BMHP",
  "Guedel Airway 70mm (putih) / Mayo No. 1 BMHP",
  "Nasal Canul O2 (Selang O2) dewasa BMHP",
  "Guedel Airway 90mm (kuning) / Mayo No. 3 BMHP",
  "Guedel Airway 80mm (hijau) / Mayo No. 2 BMHP",
  "Urine Bag BMHP",
  "Urinary Foley Catheter 14 BMHP",
  "Urinary Foley Catheter 16 BMHP",
  "Endotracheal Tube (ETT)-Cuffed 7.0 mm BMHP",
  "Endotracheal Tube (ETT)-Cuffed 7.5 mm BMHP",
  "Elektroda Medica (EKG) Dewasa (ECG Elektrodes Radiotranslucent Adult) BMHP",
  "NGT/Stomach Tube 14 Terumo 125 cm BMHP",
  "Handskun Steril/Steril Glove No. 6.5 BMHP",
  "NGT/Stomach Tube 16 Terumo 125 cm BMHP",
  "Infuset Dewasa BMHP",
  "Spuit 10 cc Stera (Syringe 10 cc Stera) BMHP",
  "IV Catheter No 22G 1\" BMHP",
  "IV Catheter No 20G 1\" BMHP",
  "IV Catheter No 24G 3/4\" BMHP",
  "Dermafix S IV 6 x 7 cm BMHP",
  "Spuit 50 cc Lubang Tengah (Loerlock) BMHP",
  "Spuit 3 cc Stera (Syringe 3 cc Stera) BMHP",
  "Three Way stop cock connecta (TANPA EKOR) BMHP",
  "IV Catheter No 18G BMHP",
  "Alkohol Swab BMHP",
  "Needle 23G BMHP",
  "Extension Tubing 150 cm (Injectomat) BMHP",
  "Three Way stop WITH TUBE (ADA EKOR) BMHP",
  "Needle 18G BMHP",
  "Spuit 5 cc Stera (Syringe 5 cc Stera) BMHP",
  "Transfusi Set Terumo (Hanya untuk Pungsi) BMHP",
  "Ringer Lactate (RL) infus 500 ml CAIRAN",
  "D5% infus 500 ml CAIRAN",
  "Gelafusal infus 500 ml (Gelatin Polysuccinate 4%) CAIRAN",
  "NaCl 0,9% infus 500 ml CAIRAN",
  "Fentanyl 0,05 mg/ml inj @2 ml OBAT (N)",
  "Midazolam inj 1 mg/ml @ 5 ml OBAT (P)",
  "Digoxin 0,25 mg/ml inj OBAT (HA)",
  "Morfina inj 10 mg/ml @1 ml (Morphine) @10 OBAT (N)",
  "Neodex OP inj 100 mcg/ml @2 ml (Dexmedetomidine) OBAT",
  "D10% infus 500 ml CAIRAN",
  "Gliseril trinitrat injeksi 1 mg/ml OBAT",
  "Heparin Sodium INJ 25000 UI/ 5mL OBAT (HA)",
  "Ketamine HCl Inj 100 mg/mL 10 mL IV/IM OBAT (HA)",
  "Lodomer INJ 5 mg/ml (Haloperidol) OBAT",
  "Nicardipine HCl inj 1 mg/ml @10 ml OBAT",
  "Propofol inj 1% (200 mg/20 ml) OBAT (HA)"
];

const RAW_STAFF_DATA = `
TITANIA YUDHA H REKAM MEDIK
WAHYU UNTARI AJI REKAM MEDIK
dr. INTAN PERMATA SARI, Sp.N DOKTER
ANDHIKA RHAININTYA H, S.Kom STAFF
HADI AGUS RAMDHONI IT
FERY TRI LAKSONO KASIR
dr. HENDRATNA M TEDJASEPUTRA DOKTER
JUNARDI ANALIS LAB
SAPTARSI INDRIATI PERAWAT
BEJO WIYONO ANALIS LAB
drg. LESLIE JANE DESIREE TULONG, MPH DIREKSI
SURYANI PERAWAT
dr. HITAPUTRA AGUNG WARDHANA, Sp.B DOKTER
DWI KISWATI PERAWAT
WAHYUNI PERAWAT
dr. SRI SUMIYATI, Sp.Rad DOKTER
LILIK SULISTYO WIDODO, SKM KONSELOR
TUGINAH KADARSIH ANALIS LAB
SUPARTI PERAWAT
RASJID RIDHO PERAWAT
dr. SUTANTO DOKTER
DRAJAD HARI SRIWIDODO ANALIS LAB
SUWARTO RADIOGRAFER
SUPATNO, S.Kep,Ners DIREKSI
DWI NARIMO SANYOTO, S.Kep PERAWAT
Y BAMBANG DWI ATMOKO, S.Kep PERAWAT
WINARTI ASISTEN APOTEKER
AGUSTIN NUR ARIFAH, SKM, MPH STAFF
dr. HARSONO, Sp.PK DOKTER
FONDHA HERAWATI, S.Kep PERAWAT
WAHONO SRI WARDOYO ANALIS LAB
dr. MASYUDI SUBAGIYO, Sp.OG,M.Kes DOKTER
SEPTIANA HANIFAH MARDIYATI PERAWAT
PAUZIAH PERAWAT
TRI WIDAYATI ASISTEN APOTEKER
PUJI LESTARI RADIOGRAFER
LIA NURLIA PERAWAT
SALEH UTOMO, S.ST RADIOGRAFER
ENDANG PURWANTI RADIOGRAFER
SUPRIYADI PERAWAT
dr. NOVITA EVA SAWITRI, Sp.P DOKTER
DESY ENDRAWATI ASISTEN APOTEKER
SITI CHAIRINI ANALIS LAB
NARKO WIYONO, S.Kep PERAWAT
dr. NIWAN TRISTANTO MARTIKA, Sp.P DOKTER
WIYONO ASISTEN APOTEKER
dr. ROBETH ERIA, Sp.OG DOKTER
RETNO DESI ARIYANI, S.Gz. GIZI
drg. ISMIARTO TRIWISONO DOKTER
dr. JAMILATUN ROSIDAH, MM DIREKSI
IRMA MEI KHAWATI GIZI
SRI LESTARI FISOTERAPIS
INDARTI DIAN PURWANI, S.Farm, Apt APOTEKER
DEWI KANIA AGUSMINAR IT
BETTY NURCAHAYA SIMATUPANG PERAWAT
MUTMAINAH PERAWAT
dr. DIAN HENDRAWATI PRASETYA, MM DOKTER
dr. Dyaning Purno Mahargiani, MM DOKTER
dr. RIANA SARI, Sp.P DOKTER
FATONAH SULISTYOWATI, SST FISOTERAPIS
POMFILIA GRACEWATY ZENDRATO, SKM KONSELOR
SITI NURUL MEISAROH PERAWAT
RATIH KUNTOWATI ANALIS LAB
dr. MAKIYATUL MUNAWWAROH, Sp.PD DOKTER
PUTRIANI KARTIKA PERAWAT
JOKO WIYONO PERAWAT
MAY KUSUMASTUTI PERAWAT
SRI SURANI REKAM MEDIK
SUHARDI WIYONO PERAWAT
HENI MIRAWATI PERAWAT
ASTRI SULAIKA KONSELOR
HERLINA TRI HANGGORO SUBEKTI PERAWAT
dr. SONDANG KRISTON PANJAITAN, Sp.An DOKTER
NARDI KASIR
JOKO SUSANTO PERAWAT
dr. EKO PRAYUNANTO ADHI NUGROHO DOKTER
SEKTI GENDRO RINI PERAWAT
IDA RUSYANTI RADIOGRAFER
EDI PAMBUKO, S.Kep PERAWAT
FEBRI PURWANTINI ANUGRAHANINGSIH, S.Si,Apt APOTEKER
RETNO PREHATI PERAWAT
YULI HASTUTI PERAWAT
HERNI INDRASMI FISOTERAPIS
NINA ADIANA PERAWAT
HARJO IT
dr. ELLY RAHMAWATI, SP.M DOKTER
JUMINI, S.Kep., Ns PERAWAT
dr. ANTARY DESVI DANIA, Sp.PD DOKTER
ULFAH USWATUN HASANAH, S.Kep PERAWAT
YUDHI DEWI TIMORITA ASISTEN APOTEKER
ENDANG WURYANI REKAM MEDIK
dr. ERNAWATI ATMANINGTYAS DOKTER
KADEK SULISTIYOWATI ASISTEN APOTEKER
BAKTI UTAMI, SKM STAFF
dr. HAMID, Sp.A DOKTER
RETNO AYU BUDININGSIH ASISTEN APOTEKER
SUBROTO PERAWAT
NORMA HADI UTAMI ASISTEN APOTEKER
WIWIN RETNO SAVITRI PERAWAT
dr. ANITA WIJIASARI DOKTER
SULISTIYANI PERAWAT
DEWI MARINA PURBASARI, SE KASIR
dr. HERMAWAN SURYA DHARMA, Sp.THT DOKTER
RESIA PERWIRANI REKAM MEDIK
GALIH UNGGUL KURNIAWATI PERAWAT
WINDHY JAYANTI, S.IKom STAFF
YULIANI DWI ASTUTI PERAWAT
WAHID BUDI NUGROHO, S.Farm, Apt APOTEKER
NINDRI SUDIANA PERAWAT
NINA PURWANINGSIH PERAWAT
RIRIN NURYANTI REKAM MEDIK
GURUH ANANG SETYADI, A.Md REKAM MEDIK
ENI DWI RETNOSARI IT
MOHAMMAD NURIZAL RAMADHANI PERAWAT
AHMAD ROMADHONA PERAWAT
BAYU SUGIARNO, S.Kom IT
HAFIDZATUL KARIMAH ANALIS LAB
SETYAWAN ANALIS LAB
dr. VANIA PUSPITASARI DOKTER
dr. YULIANA SETYOWATI DOKTER
FARADILA GUS LINGGAR REKAM MEDIK
LUTFI NAHRIKA WARNANINGRUM ANALIS LAB
RIRIN SEPTYA LIESTI, SE STAFF
dr. BENNU BEKHORAH JEDIJAH DOKTER
SITI HAJAR RADIOGRAFER
NURWAHYUNINGRUM STAFF
LILIS NUR KUSUMA PERAWAT
HANUNG COKRO KUSUMO, SE BMN
ANI WIJAYANTI BMN
RINA SAPTANTI BIDAN
AGNESIA AYU PURWANTO BMN
BRITA RAHAMINTA, Ners PERAWAT
PRATIWI HENING WULANSARI, S.Farm, Apt APOTEKER
dr. ELINA DEVIANA DOKTER
NINIK PREHATIN YUNIARTI PERAWAT
TAUFAN AFGANI ANALIS LAB
AZIS SULISTIYO ASISTEN PENATA ANASTESI
FAJAR ANITA SARI PERAWAT
NIKEN SARI WAHYUNI PERAWAT
ANIK SETYANINGSIH PERAWAT
VIDYASARI EKAPUTRI REKAM MEDIK
dr. AYU YONIKO CHRISTI DOKTER
LATIF SUSANTO PERAWAT
Anafia Azzahra Pratiwi ASISTEN APOTEKER
CHRISNAMURTI DHIPAYANA RADIOGRAFER
FAJAR RUSWANDARI, S.Gz GIZI
ANNIS KURNIA RAMADHANI PERAWAT
RINA YULIATI PERAWAT
YUDHIA RIZCHAWATI PERAWAT
Ratri Rokhani APOTEKER
AYUNITA MASHITOH PERAWAT
dr DAYINTA DRASTI KANDISA DOKTER
IIN KUSUMA CAHYA NINGRUM PERAWAT
NORMA ANDRIYANI PERAWAT
AMAR MUKANAF REKAM MEDIK
ESTI DWI RAHAYU PERAWAT
Dimas Yoga Pangestu SPI
SRI INDAHSARI REKAM MEDIK
MIRA RAHMAWATI PERAWAT
ELYZABETH HILDA PIASTER PERAWAT
RONA FITRIANA, A.Md.Farm ASISTEN APOTEKER
dr. Helsi Rismiati DOKTER
NAWANG SURYANINGTYAS PERAWAT
dr. ARIF KURNIAWAN LISTIANTO DOKTER
Ferina Andriyanti BMN
NADIA DESPINA ARAYA ANALIS LAB
EKO YULIANTO PERAWAT
PUTRI SEPTA REGINA WULANDARI BIDAN
dr. BERNITA NUR CAHYANI DOKTER
dr. INTAN REINA RAMADHANI DOKTER
HANNA HANINDYASTITI PERAWAT
YOGA NDARU RIYADI PERAWAT
ALIFFIA HANU WARDHANA BIDAN
APRILIANA PRATIWI STAFF
MARIA KRISDAYANTI PERAWAT
VIRANI NURIANISA PERAWAT
ENDANG UNTARI BIDAN
RIZQY CAHYANING M STAFF
dr. CHAIRUL IHSAN LUBIS DOKTER
YUSI NOVA RAHMAWATI, A.Md.Farm ASISTEN APOTEKER
ANGGUN NOVILLA RIZKY BIDAN
PRAFTI RAFSANJANI ANALIS LAB
dr. HANAN ANWAR RUSIDI DOKTER
dr. ARSIE NOOR RAFIDAH DOKTER
dr. GALUH ARUM PERMATASARI DOKTER
dr. ANNISA NUR HAFIKA DOKTER
FELLA SYIFA, S.Farm, Apt APOTEKER
Prasasya Kirana - ABDUL GHONI PERAWAT
ISTIANA MAHYA HANIFA, A.Md.Farm ASISTEN APOTEKER
LILIS REJEKI, S.Farm, Apt APOTEKER
MUHAMMAD WILDAN JAUHAR PERAWAT
SETIA ANDIKA RADIOGRAFER
IMTIKHANA ARFIYANY PERAWAT
UMDHAH MUFIDHAH WAHYU ANDINI PERAWAT
TRIYANA HANDAYANI PERAWAT
HALIMATUSSYA DIAH PERAWAT
MUHAMMAD IHSAN RASYID PERAWAT
MUHSIN BAYU AJI FADHILLAH, S.Kom IT
ELIAN SUCI TIWANINGTYAS BIDAN
drg. FRIDANIYANTI KHUSNUL KHOTIMAH DOKTER
SEPTI KURNIASIH PERAWAT
JIHAN AYU SAPUTRI, SKM KONSELOR
PUTRI PERBOWO MUKTI PERAWAT
MUHAMMAD IQBAL RUSHANFIKRI, S.Farm,Apt APOTEKER
Chrisya Diebber Baneftar ANALIS LAB
Yarbela Cahya Wardani REKAM MEDIK
Uzlifati Jannatin Alfafa FISOTERAPIS
Kirana Nindya Kartika FISOTERAPIS
Istiqomah Agustina Wulandari REKAM MEDIK
Luthfi Aqiila Pramana FISOTERAPIS
ARIYANI PERMATA SARI D PERAWAT
dr. FAIKA OESMANIA, Sp.OG DOKTER
FAJAR MUTIARA, SE KASIR
AGUNG JONI KUSWOYO KASIR
YENNY RACHMAWATI PERAWAT
RIA ASTRIYANI REKAM MEDIK
dr. REGA LAROSA DOKTER
LILIS SETYOWATI BIDAN
RETNO DYAS WATI BIDAN
TRI HARTANTI BIDAN
DWI ROCHMANI BIDAN
SRI MARTINI BIDAN
RIKA FITRI AGUSTINA PERAWAT
AYU FATIMAH SETYANINGSIH PERAWAT
MUAMMAR HANIF FARISI PERAWAT
RINA PUJIATI PERAWAT
dr. ARIF BUDI S, Sp.B DOKTER
MIFTAKHUL FUAD PENDAFTARAN
MILA MELATI PENDAFTARAN
FACHRIZAL RADIOGRAFER
KURNIA PUTRI ANGGRAINI ASISTEN APOTEKER
ERLINA SETYA PRAMUDITA BIDAN
DWI ERNAWATI BIDAN
RATNA RESPATI RIYANTO PUTRI BIDAN
ANI SOFIANI BIDAN
INDAH PUJI LESTARI PERAWAT
HASNA HALISA PERAWAT
AYU BUDIATI PERAWAT
DWI RIYANI PERAWAT
FIQIH ADHAM PRATIWI PERAWAT
dr. SRIYANTO, M.SI.Med, Sp.B DOKTER
HERI SAPUTRO PERAWAT
CHAFIDATUL CHASYANAH PERAWAT
RUMDYAH ANGGRAINI ANALIS LAB
YUYUN ANITASARI ANALIS LAB
NURUL HALIFAH ANALIS LAB
TIARA ANNISA ROHMAH ASISTEN APOTEKER
DIYAH KUSUMAWATI BIDAN
ASTRI NUR ISTIQOMAH BIDAN
IHSAN NASHIRUDDIN PERAWAT
EKA DANI ISWARA PERAWAT
FURI NUR FAUZI PERAWAT
ANGGIT CAROKO PERAWAT
ROVI CHOIRIYAH MAHALAWIDA PERAWAT
AYU DIYAH FATMAWATI PERAWAT
DEVI ENDAH LESTARI PERAWAT
CHUSNUL CHOTIMAH PERAWAT
DESI WULANDARI PERAWAT
GALIH RAMADHANA PUTERA NUGROHO PERAWAT
ENDAR YULI ANA PERAWAT
dr. ROBBY MESAKH NGAHU, Sp.An DOKTER
dr. Alexandra Destra P DOKTER
dr. Enrieka Yosefina P DOKTER
dr. Eva Ayu Angelina DOKTER
Dr. NURROHMAN ANINDIETA Sp.An. DOKTER
dr. ACHMAD AKBAR KUSUMA DOKTER
dr. FAIZ IKRAM PRANOTO DOKTER
dr. ARIF APRIYANTO, Sp.N DOKTER
dr. ANDHIKA HERNAWAN N, Sp.U DOKTER
dr. MARITA PUSPITASARI DOKTER
dr. UMMI RINANDARI, Sp.DV DOKTER
dr. MOHAMMAD ZAKKY FANANIE, Sp.JP, FIHA DOKTER
dr. HARY PURWONO, Sp.KJ DOKTER
ASTRI PANGESTUTI KARINA ASISTEN APOTEKER
dr. HANDIKA ZULIMARTIN, Sp.OG DOKTER
dr. R. SAGITHA INDRAYANA, Sp.OT, M.Biomed DOKTER
Rini Pramuati, S.Farm, Apt. APOTEKER
Dyah Fatimatussholichah, S.Farm, Apt APOTEKER
Anafia Azzahra Pratiwi ASISTEN APOTEKER
Dinda Nur Dhuhania ASISTEN APOTEKER
Ambran Setyo Cahyoko PERAWAT
Ima Maftuchur Rahmah PERAWAT
Aisya Devi Kusuma PERAWAT
Septi Tri Utami PERAWAT
Anggraeni Prameswari Putri PERAWAT
Niken Budi Astuti PERAWAT
Eka Fitriyani PERAWAT
Evan Alditya Nugraha PERAWAT
Wahyu Fitriana PERAWAT
Ahmad Abror Mubarok Suratman PERAWAT
Ana Masriah Nur Hidayati PERAWAT
Annisa Ismayatul Khoiriyah S.Tr.Kep.Ners PERAWAT
Fina Trihastuti PERAWAT
Fathonah Eka Pratiwi, S.Kep., Ns PERAWAT
Vellin Ramadhani, A.Md.Kep PERAWAT
Hendri Purnomoaji PERAWAT
Febri Indah Cahyo, A.Md.Kep. PERAWAT
Mifta Nur Fadzilah A.Md.Kep PERAWAT
Yoga Bima Nugroho PERAWAT
Fredi Rudi Arianto, S.Kep, Ns PERAWAT
Sudrajat Jati A.Md. Kep. PERAWAT
Wulandari Chandra Pratiwi PERAWAT
Indra Yuniawan PERAWAT
Rachmalia Wulandari PERAWAT
Sinta Febri Sulistiani PERAWAT
Rully Fitriyanti PERAWAT
Rina Massella PERAWAT
Herni Sutrisno Putri PERAWAT
Nurul Ekayanti PERAWAT
Asri Mardela Suci PERAWAT
Dewi Julianingtiyas PERAWAT
Sugiarto PERAWAT
Nuzula Syifaul Khujun PERAWAT
dr. HENDRA WARDHANA, Sp.A DOKTER
dr. KOMANG KUSUMAWATI, Sp.KFR DOKTER
dr. MARCELLINO METTAFORTUNA S, Sp.PD, AIFO-K DOKTER
dr. KRISTIANTO ARYO N, Sp.THT-KL DOKTER
dr. MEGA ANARA MANURUNG, Sp.U DOKTER
dr. LISA PUSPADEWI SUSANTO, Sp.OG DOKTER
dr. INTANIAR DOKTER
dr. WARIH KUSUMA DOKTER
dr. NOVIA DYAH INDRIYATI DOKTER
dr. AZKA AULIARAHMAN DOKTER
dr. SOEBANDRIJO, Sp.B., Sp.BTKV(K) DOKTER
dr. DANISWARA WISNU WARDHANA, Sp.M DOKTER
AGUS HARYATMO PSIKOLOG
dr. Yoga Yudhistira, Sp.JP, FIHA DOKTER
dr. Azza Nur Laila Masaidd DOKTER
dr. IVANA TANSIL,Sp.DVE DOKTER
dr. Shafira Nur Hanifa DOKTER
dr. Adhitya Surya Dwi Atmaja DOKTER
dr. ESTI TANTRI ANANDANI, Sp.PD DOKTER
dr. TRIMANTO WIBOWO, Sp.OT, M.Biomed DOKTER
Amelia Nabilla REKAM MEDIK
ANGGIT NURHIDAYAH IT
Aulia Rani Sholichah REKAM MEDIK
Ainaya Nur Faatihah BMN
dr. NADIYAH MUHAMMAD, Sp.PA(K) DOKTER
dr. NOVAN ADI SETYAWAN, Sp.PA DOKTER
dr. HALIDA DWINA SARI, Sp.Rad DOKTER
Hasmi Suryo Wicaksono KASIR
Nadia Fitri Hafisah PERAWAT
PKBLU STAFF
Rita Listiawati PERAWAT
dr. ACHMAD AKBAR KUSUMA DOKTER
dr. Adhitya Surya Dwi Atmaja DOKTER
dr. ANDHIKA HERNAWAN N, Sp.U DOKTER
dr. ANITA WIJIASARI DOKTER
dr. ANNISA NUR HAFIKA DOKTER
dr. ANTARY DESVI DANIA, Sp.PD DOKTER
dr. ARIF APRIYANTO, Sp.N DOKTER
dr. ARIF BUDI S, Sp.B DOKTER
dr. ARSIE NOOR RAFIDAH DOKTER
dr. AZKA AULIARAHMAN DOKTER
dr. Azza Nur Laila Masaidd DOKTER
dr. BENNU BEKHORAH JEDIJAH DOKTER
dr. BERNITA NUR CAHYANI DOKTER
dr. DANISWARA WISNU WARDHANA, Sp.M DOKTER
dr. DIAN HENDRAWATI PRASETYA, MM DOKTER
dr. Dyaning Purno Mahargiani, MM DOKTER
dr. EKO PRAYUNANTO ADHI NUGROHO DOKTER
dr. ELINA DEVIANA DOKTER
dr. ELLY RAHMAWATI, SP.M DOKTER
dr. Enrieka Yosefina P DOKTER
dr. ERNAWATI ATMANINGTYAS DOKTER
dr. ESTI TANTRI ANANDANI, Sp.PD DOKTER
dr. Eva Ayu Angelina DOKTER
dr. FAIKA OESMANIA, Sp.OG DOKTER
dr. FATIMAH MAYASYARI, Sp. A DOKTER
dr. GALUH ARUM PERMATASARI DOKTER
dr. HAMID, Sp.A DOKTER
dr. HANAN ANWAR RUSIDI DOKTER
dr. HANDIKA ZULIMARTIN, Sp.OG DOKTER
dr. HARSONO, Sp.PK DOKTER
dr. HARY PURWONO, Sp.KJ DOKTER
dr. Helsi Rismiati DOKTER
dr. HENDRA WARDHANA, Sp.A DOKTER
dr. HERMAWAN SURYA DHARMA, Sp.THT DOKTER
dr. HITAPUTRA AGUNG WARDHANA, Sp.B DOKTER
dr. INDAH PUJI HANDAYANI, Sp.KJ DOKTER
dr. INTAN PERMATA SARI, Sp.N DOKTER
dr. INTAN REINA RAMADHANI DOKTER
dr. INTANIAR DOKTER
dr. IVANA TANSIL,Sp.DVE DOKTER
dr. KRISTIANTO ARYO N, Sp.THT-KL DOKTER
dr. LISA PUSPADEWI SUSANTO, Sp.OG DOKTER
dr. MAKIYATUL MUNAWWAROH, Sp.PD DOKTER
dr. MARCELLINO METTAFORTUNA S, Sp.PD, AIFO-K DOKTER
dr. MARITA PUSPITASARI DOKTER
dr. MASYUDI SUBAGIYO, Sp.OG,M.Kes DOKTER
dr. MEGA ANARA MANURUNG, Sp.U DOKTER
dr. MOHAMMAD ZAKKY FANANIE, Sp.JP, FIHA DOKTER
dr. NIWAN TRISTANTO MARTIKA, Sp.P DOKTER
dr. NOVIA DYAH INDRIYATI DOKTER
dr. NOVITA EVA SAWITRI, Sp.P DOKTER
Dr. NURROHMAN ANINDIETA Sp.An. DOKTER
dr. R. SAGITHA INDRAYANA, Sp.OT, M.Biomed DOKTER
dr. RIANA SARI, Sp.P DOKTER
dr. ROBBY MESAKH NGAHU, Sp.An DOKTER
dr. ROBETH ERIA, Sp.OG DOKTER
dr. Shafira Nur Hanifa DOKTER
dr. SOEBANDRIJO, Sp.B., Sp.BTKV(K) DOKTER
dr. SONDANG KRISTON PANJAITAN, Sp.An DOKTER
dr. SRI SUMIYATI, Sp.Rad DOKTER
dr. SRIYANTO, M.SI.Med, Sp.B DOKTER
dr. SUTANTO DOKTER
dr. TRIMANTO WIBOWO, Sp.OT, M.Biomed DOKTER
dr. VANIA PUSPITASARI, Sp.Rad DOKTER
dr. WARIH KUSUMA DOKTER
dr. Yoga Yudhistira, Sp.JP, FIHA DOKTER
dr. YULIANA SETYOWATI DOKTER
dr.KOMANG KUSUMAWATI,SpKFR.M.Pd DOKTER
drg. ISMIARTO TRIWISONO DOKTER
drg. LESLIE JANE DESIREE TULONG, MPH DOKTER
`;

const parseStaffData = (rawData: string): StaffMember[] => {
  // Sort roles by length desc to ensure "ASISTEN APOTEKER" is matched before "APOTEKER"
  const roles = [
    "ASISTEN APOTEKER", "ASISTEN PENATA ANASTESI", "REKAM MEDIK", "ANALIS LAB", 
    "RADIOGRAFER", "FISOTERAPIS", "PSIKOLOG", "KONSELOR", "PENDAFTARAN", 
    "DOKTER", "PERAWAT", "BIDAN", "APOTEKER", "STAFF", "DIREKSI", 
    "GIZI", "BMN", "IT", "KASIR", "SPI"
  ];
  
  return rawData.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      line = line.trim();
      let foundRole = "STAFF";
      let name = line;
      
      for (const role of roles) {
        if (line.toUpperCase().endsWith(role)) {
          foundRole = role;
          // If the line is just the role, keeping it as name might be weird, but mostly name + role
          if (line.length > role.length) {
            name = line.substring(0, line.length - role.length).trim();
          }
          break;
        }
      }
      return { name, role: foundRole };
    });
};

const STAFF_DATABASE = parseStaffData(RAW_STAFF_DATA);

// --- Components ---

const StaffAutocomplete = ({ 
  label, 
  name, 
  value, 
  onChange, 
  allowedRoles 
}: { 
  label: string, 
  name: string, 
  value: string, 
  onChange: (e: any) => void, 
  allowedRoles: string[] 
}) => {
  const [suggestions, setSuggestions] = useState<StaffMember[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filteredDb = React.useMemo(() => {
    return STAFF_DATABASE.filter(p => allowedRoles.includes(p.role));
  }, [allowedRoles]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(e);

    if (val.length > 0) {
      const search = val.toLowerCase();
      const matches = filteredDb.filter(p => p.name.toLowerCase().includes(search)).slice(0, 50);
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
      setSelectedIndex(-1);
    } else {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  const handleSelect = (person: StaffMember) => {
    onChange({ target: { name, value: person.name } });
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % (suggestions.length || 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + (suggestions.length || 1)) % (suggestions.length || 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSelect(suggestions[selectedIndex]);
        } else if (suggestions.length > 0) {
          handleSelect(suggestions[0]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-gray-400" />
        </div>
        <input
          type="text"
          name={name}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            if (e.target.value.length > 0) {
               const search = e.target.value.toLowerCase();
               const matches = filteredDb.filter(p => p.name.toLowerCase().includes(search)).slice(0, 50);
               setSuggestions(matches);
               setShowSuggestions(matches.length > 0);
            } else {
               setSuggestions(filteredDb.slice(0, 50));
               setShowSuggestions(true);
            }
          }}
          className="w-full pl-9 pr-8 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
          autoComplete="off"
          placeholder={`Cari ${label}...`}
        />
        {value && (
          <button 
            type="button"
            onClick={() => {
              onChange({ target: { name, value: "" } });
              setShowSuggestions(false);
              setSelectedIndex(-1);
            }}
            className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
            {suggestions.map((person, idx) => (
              <li
                key={idx}
                className={`relative cursor-pointer select-none py-2 pl-3 pr-9 transition-colors border-b border-gray-50 last:border-0 ${
                  idx === selectedIndex ? "bg-red-100" : "hover:bg-red-50"
                } text-gray-900`}
                onClick={() => handleSelect(person)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="block truncate font-medium">{person.name}</span>
                <span className="block truncate text-xs text-gray-500">{person.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const formatDateTime = (dateString: string) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const strHours = String(hours).padStart(2, '0');
  
  return `${day}/${month}/${year}, ${strHours}:${minutes}:${seconds} ${ampm}`;
};

const LogCard = ({ log, onSeal, onDelete, onNotify }: { log: TrolleyForm, onSeal: (id: string, data: {newKeyNumber: string, pharmacistName: string, sealTimestamp: string}) => void | Promise<void>, onDelete: (id: string) => void | Promise<void>, onNotify: (msg: string, type: 'success' | 'error') => void, key?: any }) => {
  const [sealData, setSealData] = useState({
    newKeyNumber: "",
    pharmacistName: "",
    sealTimestamp: getJakartaDateTime()
  });
  const [hasEditedTime, setHasEditedTime] = useState(false);
  const [showPharmacistSuggestions, setShowPharmacistSuggestions] = useState(false);
  const pharmacistInputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pharmacistInputRef.current && !pharmacistInputRef.current.contains(event.target as Node)) {
        setShowPharmacistSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInteraction = () => {
    if (!hasEditedTime) {
      setSealData(prev => ({ ...prev, sealTimestamp: getJakartaDateTime() }));
    }
  };

  const filteredPharmacists = PHARMACISTS.filter(name => 
    name.toLowerCase().includes(sealData.pharmacistName.toLowerCase())
  );

  const handleSeal = () => {
    if (!sealData.newKeyNumber || !sealData.pharmacistName) {
      onNotify("Nomor kunci dan nama petugas wajib diisi", "error");
      return;
    }
    onSeal(log.id, sealData);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-all hover:shadow-md border-l-4 border-l-red-500 relative group">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-bold text-gray-900">{log.patientName}</h3>
            {log.serialNumber && (
              <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider">
                {log.serialNumber}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center text-sm text-gray-500 mt-2 gap-2">
            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 font-mono text-xs">RM: {log.mrn}</span>
            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 text-xs flex items-center"><User className="w-3 h-3 mr-1" /> Bed: {log.room}</span>
            {log.trolleyLocation && (
              <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 text-xs flex items-center"><MapPin className="w-3 h-3 mr-1" /> Troli: {log.trolleyLocation}</span>
            )}
            {log.keyNumber && (
              <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 text-xs flex items-center"><Key className="w-3 h-3 mr-1" /> Kunci: {log.keyNumber}</span>
            )}
            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 text-xs flex items-center"><Clock className="w-3 h-3 mr-1" /> {formatDateTime(log.timestamp)}</span>
          </div>
        </div>
        
        {!log.newKeyNumber && !log.pharmacistName && (
          <button
            onClick={() => onDelete(log.id)}
            className="p-2 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-all shadow-sm"
            title="Hapus Log"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>
      
      <div className="border-t border-gray-100 pt-4 mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Diagnosis & Tim</h4>
          <p className="text-sm text-gray-800 mb-1 font-medium">{log.diagnosis || "Tanpa Diagnosis"}</p>
          <p className="text-sm text-gray-600 italic">Dr. {log.doctorName || "???"} & Ns. {log.nurseName || "???"}</p>
        </div>
        <div>
           <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Item yang Digunakan</h4>
           <div className="flex flex-wrap gap-2">
              {log.items.map(item => (
                <span key={item.id} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                  <span className="mr-1 opacity-60 text-[10px] uppercase font-bold tracking-tighter">[{item.type}]</span>
                  {item.name} <span className="ml-1.5 px-1 bg-red-100 rounded text-red-800 font-bold">{item.quantity}</span>
                </span>
              ))}
           </div>
        </div>
      </div>

      {/* Penyegelan Info / Form */}
      {(log.newKeyNumber || log.pharmacistName) ? (
        <div className="mt-5 bg-[#e8fee8] p-4 rounded-xl border border-green-200 text-center">
          <h4 className="text-xs font-bold text-green-700 uppercase tracking-wider mb-3 flex items-center justify-start text-left">
            <Lock className="w-3 h-3 mr-1" /> Penyegelan Farmasi
          </h4>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-8 text-sm">
            <p><span className="text-green-800 opacity-70">Kunci Baru:</span> <span className="font-medium text-green-900 ml-1">{log.newKeyNumber || '-'}</span></p>
            <p><span className="text-green-800 opacity-70">Petugas:</span> <span className="font-medium text-green-900 ml-1">{log.pharmacistName || '-'}</span></p>
            <p><span className="text-green-800 opacity-70">Waktu:</span> <span className="font-medium text-green-900 ml-1">{formatDateTime(log.sealTimestamp)}</span></p>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-100 pt-4 mt-4 bg-red-50 -mx-6 px-6 pb-4 rounded-b-xl">
          <h4 className="text-xs font-bold text-red-700 uppercase tracking-wider mb-3 flex items-center">
            <Lock className="w-3 h-3 mr-1" /> Form Penyegelan Farmasi
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
            <div>
              <input
                type="text"
                placeholder="Nomor Kunci Baru"
                value={sealData.newKeyNumber}
                onFocus={handleInteraction}
                onChange={e => setSealData({...sealData, newKeyNumber: e.target.value})}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
              />
            </div>
            <div className="relative" ref={pharmacistInputRef}>
              <input
                type="text"
                placeholder="Nama Petugas"
                value={sealData.pharmacistName}
                onFocus={() => {
                  handleInteraction();
                  setShowPharmacistSuggestions(true);
                }}
                onChange={e => {
                  setSealData({...sealData, pharmacistName: e.target.value});
                  setShowPharmacistSuggestions(true);
                }}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border bg-white"
              />
              {showPharmacistSuggestions && filteredPharmacists.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-48 rounded-md py-1 text-sm ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none">
                  {filteredPharmacists.map(name => (
                    <li
                      key={name}
                      onClick={() => {
                        setSealData({...sealData, pharmacistName: name});
                        setShowPharmacistSuggestions(false);
                      }}
                      className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-red-50 hover:text-red-900 text-gray-900"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <input
                type="datetime-local"
                value={sealData.sealTimestamp}
                onChange={e => {
                  setHasEditedTime(true);
                  setSealData({...sealData, sealTimestamp: e.target.value});
                }}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSeal}
              className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 transition-colors"
            >
              Segel Troli
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const LoginScreen = () => {
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-md max-w-md w-full text-center">
        <div className="bg-red-100 p-4 rounded-full inline-block mb-4">
          <Activity className="w-10 h-10 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Troli Emergency</h1>
        <p className="text-gray-500 mb-8">Sistem Log Pemakaian Troli Emergency Terpadu</p>
        <button
          onClick={handleLogin}
          className="w-full bg-red-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
        >
          <User className="w-5 h-5" />
          Masuk dengan Google
        </button>
      </div>
    </div>
  );
};

const App = () => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<"form" | "history">("form");
  const [formData, setFormData] = useState<TrolleyForm>(() => ({ ...INITIAL_FORM, id: crypto.randomUUID(), serialNumber: generateSerialNumber() }));
  const [savedLogs, setSavedLogs] = useState<TrolleyForm[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  // Search/Suggestion State
  const [searchTerm, setSearchTerm] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);

  // History Filters State
  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [historyLocationFilter, setHistoryLocationFilter] = useState("");
  const [historyStartDate, setHistoryStartDate] = useState("");
  const [historyEndDate, setHistoryEndDate] = useState("");
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [logToDelete, setLogToDelete] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const isInitialLoad = useRef(true);

  // Initialize API Key safely
  const apiKey = process.env.API_KEY || ""; 
  
  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) return;
    const q = query(collection(db, 'trolleyLogs'), orderBy('createdAt', 'desc'));
    
    // Gunakan snapshots untuk mendeteksi perubahan spesifik (log baru)
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as TrolleyForm[];
      
      // Deteksi log baru jika bukan loading awal
      if (!isInitialLoad.current) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const newLog = change.doc.data() as TrolleyForm;
            // Hanya notifikasi jika log benar-benar baru (punya patientName)
            if (newLog.patientName && notifPermission === "granted") {
              const notification = new Notification("Log Troli Emergency Baru", {
                body: `Pasien: ${newLog.patientName} | Lokasi: ${newLog.trolleyLocation || '-'}`,
                icon: "https://cdn-icons-png.flaticon.com/512/3063/3063822.png", // Icon medis
                tag: "new-log-" + change.doc.id, // Prevent duplicate showing
              });
              
              notification.onclick = () => {
                window.focus();
                setActiveTab("history");
              };
            }
          }
        });
      }
      
      setSavedLogs(logs);
      isInitialLoad.current = false;
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'trolleyLogs');
    });
    return () => unsubscribe();
  }, [isAuthReady, user, notifPermission]);

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      showNotification("Browser Anda tidak mendukung notifikasi", "error");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission === 'granted') {
        showNotification("Notifikasi diizinkan!", "success");
        // Test notif
        new Notification("Log Troli Emergency", {
          body: "Notifikasi browser telah aktif. Anda akan menerima kabar tiap ada log baru.",
          tag: "test-notif"
        });
      } else if (permission === 'denied') {
        showNotification("Notifikasi diblokir. Harap izinkan melalui pengaturan browser Chrome Anda.", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Gagal meminta izin notifikasi", "error");
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    if (name === 'trolleyLocation') {
      const previousLog = savedLogs.find(log => log.trolleyLocation === value);
      const autoKeyNumber = previousLog?.newKeyNumber || "";
      
      setFormData((prev) => ({ 
        ...prev, 
        [name]: value,
        keyNumber: autoKeyNumber
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: checked }));
  };

  // Fungsi untuk memisahkan Nama Barang dan Jenis (OBAT/BMHP/CAIRAN)
  const parseItemInfo = (fullString: string) => {
    const categories = ["OBAT", "BMHP", "CAIRAN"];
    let name = fullString;
    let type = "-";
    
    for (const cat of categories) {
      if (fullString.includes(cat)) {
        const index = fullString.indexOf(cat);
        name = fullString.substring(0, index).trim();
        type = fullString.substring(index).trim();
        break;
      }
    }
    return { name, type };
  };

  const addItem = (itemName: string = "") => {
    if (!itemName) return;
    
    const { name, type } = parseItemInfo(itemName);
    
    const newItem: UsedItem = {
      id: crypto.randomUUID(),
      name: name,
      quantity: 1,
      type: type,
    };
    setFormData((prev) => ({ ...prev, items: [...prev.items, newItem] }));
    setSearchTerm("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const updateItem = (id: string, field: keyof UsedItem, value: any) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }));
  };

  const removeItem = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));
  };

  const filteredSuggestions = COMMON_ITEMS.filter(item => 
    item.toLowerCase().includes(searchTerm.toLowerCase()) && 
    !formData.items.some(existing => existing.name === parseItemInfo(item).name)
  );

  const filteredHistoryLogs = savedLogs.filter(log => {
    const searchLower = historySearchTerm.toLowerCase();
    const matchesSearch = !historySearchTerm || 
      log.patientName.toLowerCase().includes(searchLower) ||
      log.mrn.toLowerCase().includes(searchLower) ||
      log.room.toLowerCase().includes(searchLower) ||
      (log.doctorName && log.doctorName.toLowerCase().includes(searchLower)) ||
      (log.nurseName && log.nurseName.toLowerCase().includes(searchLower));

    const matchesLocation = !historyLocationFilter || log.trolleyLocation === historyLocationFilter;

    let matchesDate = true;
    if (historyStartDate || historyEndDate) {
      const logDateStr = log.timestamp.split('T')[0];
      if (historyStartDate && historyEndDate) {
        matchesDate = logDateStr >= historyStartDate && logDateStr <= historyEndDate;
      } else if (historyStartDate) {
        matchesDate = logDateStr >= historyStartDate;
      } else if (historyEndDate) {
        matchesDate = logDateStr <= historyEndDate;
      }
    }

    return matchesSearch && matchesLocation && matchesDate;
  });

  const handleExtractFromSimkes = async () => {
    if (!apiKey) {
      showNotification("API Key hilang (process.env.API_KEY)", "error");
      return;
    }
    
    if (!formData.narrativeNotes.trim()) {
      showNotification("Tempelkan data SIMKES terlebih dahulu pada kolom teks", "error");
      return;
    }
    
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview"; 
      
      const prompt = `
        Anda adalah asisten medis pintar. Tugas anda adalah mengekstrak entitas data dari teks mentah sistem SIMKES berikut ke dalam format JSON.
        
        Teks SIMKES:
        ${formData.narrativeNotes}
        
        Instruksi:
        HANYA ekstrak field berikut untuk bagian "Pasien & Waktu". Jika tidak ditemukan, biarkan null atau string kosong.
        - patientName: Nama lengkap pasien.
        - mrn: Nomor Rekam Medis (RM).
        - room: Lokasi ruangan/bangsal.
        - trolleyLocation: Lokasi Troli Emergency berdasarkan ruangan. Aturannya:
          - Jika ruangan mengandung "HCU", "PICU", atau "ICU", maka "TROLLY EMERGENCY ICU".
          - Jika ruangan mengandung "SADEWA INFEKSI", maka "TROLLY EMERGENCY SADEWA 1".
          - Jika ruangan mengandung "SEMBADRA" atau "SEMBODRO", maka "TROLLY EMERGENCY SEMBODRO".
          - Jika ruangan mengandung "IBS", maka "TROLLY EMERGENCY IBS".
          - Jika ruangan mengandung "IGD" (tapi bukan PONEK), maka "TROLLY EMERGENCY IGD".
          - Jika ruangan mengandung "PONEK", maka "TROLLY EMERGENCY PONEK IGD".
          - Jika ruangan mengandung "MCU", maka "TROLLY EMERGENCY MCU".
          - Jika ruangan mengandung "NICU", maka "TROLLY EMERGENCY NICU".
          - Jika ruangan mengandung "RALAN NAKULA", maka "TROLLY EMERGENCY RALAN NAKULA".
          - Jika ruangan mengandung "NAKULA" (tapi bukan RALAN), maka "TROLLY EMERGENCY NAKULA".
          - Jika ruangan mengandung "SADEWA 2", maka "TROLLY EMERGENCY SADEWA 2".
          - Jika tidak ada yang cocok, biarkan null.

        Output hanya JSON valid.
      `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const extracted = JSON.parse(response.text);

      const newTrolleyLocation = extracted.trolleyLocation || formData.trolleyLocation;
      const previousLog = savedLogs.find(log => log.trolleyLocation === newTrolleyLocation);
      const autoKeyNumber = previousLog?.newKeyNumber || formData.keyNumber;

      setFormData(prev => ({
        ...prev,
        patientName: extracted.patientName || prev.patientName,
        mrn: extracted.mrn || prev.mrn,
        room: extracted.room || prev.room,
        trolleyLocation: newTrolleyLocation,
        keyNumber: autoKeyNumber,
      }));
      
      showNotification("Data Pasien & Waktu Berhasil Diekstrak", "success");
    } catch (error) {
      console.error(error);
      showNotification("Gagal mengekstrak data SIMKES", "error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!formData.patientName || !formData.mrn) {
      showNotification("Nama Pasien dan No. RM wajib diisi", "error");
      return;
    }
    if (!user) return;
    
    try {
      const logData = {
        ...formData,
        authorUID: user.uid,
        createdAt: serverTimestamp()
      };
      // Remove id before saving to let firestore generate it
      delete (logData as any).id;
      
      await addDoc(collection(db, 'trolleyLogs'), logData);
      
      // Trigger Telegram Notification (fire-and-forget)
      fetch('/api/notify-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      }).catch(err => console.error("Failed to send telegram notification", err));

      setFormData({ ...INITIAL_FORM, id: crypto.randomUUID(), serialNumber: generateSerialNumber(), timestamp: getJakartaDateTime() });
      showNotification("Log berhasil disimpan", "success");
      setActiveTab("history");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'trolleyLogs');
    }
  };

  const handleSealLog = async (id: string, sealData: {newKeyNumber: string, pharmacistName: string, sealTimestamp: string}) => {
    try {
      await updateDoc(doc(db, 'trolleyLogs', id), sealData);
      showNotification("Troli berhasil disegel", "success");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `trolleyLogs/${id}`);
    }
  };

  const handleDeleteLog = async (id: string) => {
    const log = savedLogs.find(l => l.id === id);
    if (log && (log.newKeyNumber || log.pharmacistName)) {
      showNotification("Log yang sudah disegel tidak dapat dihapus", "error");
      return;
    }
    setLogToDelete(id);
  };

  const confirmDeleteLog = async () => {
    if (!logToDelete) return;
    
    try {
      await deleteDoc(doc(db, 'trolleyLogs', logToDelete));
      showNotification("Log berhasil dihapus", "success");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `trolleyLogs/${logToDelete}`);
    } finally {
      setLogToDelete(null);
    }
  };

  const handleExportPDFs = async () => {
    if (savedLogs.length === 0) {
      showNotification("Tidak ada data untuk diekspor", "error");
      return;
    }

    try {
      const zip = new JSZip();
      
      // Group logs by trolleyLocation
      const groupedLogs = savedLogs.reduce((acc, log) => {
        const loc = log.trolleyLocation || "Tanpa_Lokasi";
        if (!acc[loc]) acc[loc] = [];
        acc[loc].push(log);
        return acc;
      }, {} as Record<string, TrolleyForm[]>);

      // Generate PDF for each location
      for (const [location, logs] of Object.entries(groupedLogs) as [string, TrolleyForm[]][]) {
        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(16);
        doc.text(`Laporan Pemakaian Troli Emergency - ${location}`, 14, 20);
        
        let startY = 30;
        
        logs.forEach((log, index) => {
          // Add some spacing between logs if not first
          if (index > 0) {
            startY += 10;
            if (startY > 250) {
              doc.addPage();
              startY = 20;
            }
          }

          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(`Pasien: ${log.patientName} (RM: ${log.mrn})`, 14, startY);
          
          if (log.serialNumber) {
            doc.setFontSize(10);
            doc.setTextColor(220, 38, 38); // Red color for serial number
            doc.text(`[${log.serialNumber}]`, 150, startY);
            doc.setTextColor(0, 0, 0); // Reset color
          }
          
          startY += 6;
          
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          const dateStr = new Date(log.timestamp).toLocaleString("id-ID");
          doc.text(`Waktu: ${dateStr} | Ruangan: ${log.room}`, 14, startY);
          startY += 6;
          doc.text(`Dokter: ${log.doctorName || '-'} | Perawat: ${log.nurseName || '-'}`, 14, startY);
          startY += 6;
          doc.text(`Kunci Lama: ${log.keyNumber || '-'} | Kunci Baru: ${log.newKeyNumber || '-'}`, 14, startY);
          startY += 6;
          doc.text(`Petugas Farmasi: ${log.pharmacistName || '-'}`, 14, startY);
          startY += 8;

          // Items Table
          const tableData = log.items.map(item => [
            item.name,
            item.quantity.toString(),
            item.type
          ]);

          if (tableData.length > 0) {
            autoTable(doc, {
              startY: startY,
              head: [['Nama Item', 'Jumlah', 'Jenis']],
              body: tableData,
              theme: 'grid',
              headStyles: { fillColor: [220, 38, 38] }, // Red-600
              margin: { left: 14, right: 14 },
            });
            // Update startY for next log
            startY = (doc as any).lastAutoTable.finalY + 10;
          } else {
            doc.setFontSize(10);
            doc.setFont("helvetica", "italic");
            doc.text("Tidak ada item yang digunakan.", 14, startY);
            startY += 10;
          }
        });

        // Add PDF to zip
        const pdfBlob = doc.output('blob');
        zip.file(`Laporan_Troli_${location.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, pdfBlob);
      }

      // Generate and download ZIP
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `Laporan_Troli_Emergency_${new Date().toISOString().split('T')[0]}.zip`);
      
      // Delete all exported logs from Firestore
      const batch = writeBatch(db);
      savedLogs.forEach(log => {
        if (log.id) {
          batch.delete(doc(db, 'trolleyLogs', log.id));
        }
      });
      await batch.commit();
      
      showNotification("Berhasil mengekspor Laporan PDF dan mereset riwayat", "success");
      setShowExportConfirm(false);
    } catch (error) {
      console.error("Error generating PDFs:", error);
      showNotification("Gagal mengekspor PDF", "error");
      setShowExportConfirm(false);
    }
  };

  // Keyboard Navigation Logic
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) {
      if (e.key === 'Enter' && searchTerm.trim()) {
        addItem(searchTerm);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % (filteredSuggestions.length || 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + (filteredSuggestions.length || 1)) % (filteredSuggestions.length || 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredSuggestions.length) {
          addItem(filteredSuggestions[selectedIndex]);
        } else if (filteredSuggestions.length > 0) {
          // Default behavior: pick first if nothing selected but list exists
          addItem(filteredSuggestions[0]);
        } else if (searchTerm.trim()) {
          addItem(searchTerm);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  };

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div></div>;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen pb-12">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium transition-all transform translate-y-0 ${notification.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-red-600 p-2 rounded-lg">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-none">Troli Emergency</h1>
              <p className="text-xs text-gray-500 font-medium tracking-wide">FORMULIR LOG PEMAKAIAN</p>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            {/* Notification Control */}
            <button
              onClick={requestNotificationPermission}
              className={`p-2 rounded-full mr-2 transition-colors ${
                notifPermission === 'granted' 
                  ? 'text-green-600 hover:bg-green-50' 
                  : notifPermission === 'denied'
                    ? 'text-red-400 hover:bg-red-50'
                    : 'text-gray-400 hover:bg-gray-100'
              }`}
              title={
                notifPermission === 'granted' 
                  ? "Notifikasi Aktif" 
                  : notifPermission === 'denied'
                    ? "Notifikasi Diblokir"
                    : "Aktifkan Notifikasi"
              }
            >
              {notifPermission === 'granted' ? <Bell className="w-5 h-5 fill-current" /> : <BellOff className="w-5 h-5" />}
            </button>
            <button
              onClick={() => {
                setFormData({ ...INITIAL_FORM, id: crypto.randomUUID(), serialNumber: generateSerialNumber(), timestamp: getJakartaDateTime() });
                setActiveTab("form");
              }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "form" ? "bg-red-50 text-red-700" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Log Baru
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "history" ? "bg-red-50 text-red-700" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Riwayat ({savedLogs.length})
            </button>
            <div className="w-px h-6 bg-gray-300 mx-2"></div>
            <button
              onClick={() => signOut(auth)}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
              title="Keluar"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === "form" ? (
          <div className="space-y-6">
            
            {/* 1. SIMKES Data & AI Automation */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
               <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center">
                  <FileText className="w-5 h-5 text-gray-500 mr-2" />
                  <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wider">Data SIMKES (Pasien & Waktu)</h2>
                </div>
                <button
                  onClick={handleExtractFromSimkes}
                  disabled={isGenerating}
                  className="flex items-center space-x-2 text-xs font-semibold bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full hover:bg-indigo-100 transition-colors border border-indigo-200"
                >
                  <Sparkles className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>{isGenerating ? 'Menganalisa...' : 'Ekstrak Data Pasien (AI)'}</span>
                </button>
              </div>
              <div className="p-6">
                <p className="text-xs text-gray-500 mb-2">
                  Tempelkan teks mentah dari SIMKES di sini untuk mengisi identitas pasien dan waktu secara otomatis.
                </p>
                <textarea
                  name="narrativeNotes"
                  value={formData.narrativeNotes}
                  onChange={handleInputChange}
                  rows={4}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-3 border font-mono text-sm bg-gray-50"
                  placeholder="Contoh Paste:&#10;Nama: Tn. Ahmad&#10;No RM: 123456..."
                />
              </div>
            </div>

            {/* 2. Identitas Pasien & Waktu */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex items-center">
                <User className="w-5 h-5 text-gray-500 mr-2" />
                <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wider">Pasien & Waktu</h2>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nama Pasien</label>
                  <input
                    type="text"
                    name="patientName"
                    value={formData.patientName}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">No. Rekam Medis (RM)</label>
                  <input
                    type="text"
                    name="mrn"
                    value={formData.mrn}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ruangan / Bangsal</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      name="room"
                      value={formData.room}
                      onChange={handleInputChange}
                      className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal & Waktu Kejadian</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="datetime-local"
                      name="timestamp"
                      value={formData.timestamp}
                      onChange={handleInputChange}
                      className="w-full pl-9 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Resuscitation Team */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-visible">
              <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex items-center rounded-t-2xl">
                <Stethoscope className="w-5 h-5 text-gray-500 mr-2" />
                <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wider">Tim Resusitasi & Kejadian</h2>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <StaffAutocomplete
                    label="Dokter PJ"
                    name="doctorName"
                    value={formData.doctorName}
                    onChange={handleInputChange}
                    allowedRoles={["DOKTER"]}
                  />
                </div>
                <div>
                  <StaffAutocomplete
                    label="Perawat PJ"
                    name="nurseName"
                    value={formData.nurseName}
                    onChange={handleInputChange}
                    allowedRoles={["PERAWAT", "BIDAN"]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Diagnosis</label>
                  <input
                    type="text"
                    name="diagnosis"
                    value={formData.diagnosis}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                  />
                </div>
              </div>
            </div>

            {/* 4. Items Used with Suggestion Mechanism */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center">
                  <Syringe className="w-5 h-5 text-gray-500 mr-2" />
                  <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wider">Obat & Peralatan yang Digunakan</h2>
                </div>
              </div>
              <div className="p-6">
                {/* Trolley Location & Key Number */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lokasi Troli</label>
                    <select
                      name="trolleyLocation"
                      value={formData.trolleyLocation}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border bg-white"
                    >
                      <option value="">-- Pilih Lokasi Troli --</option>
                      {TROLLEY_LOCATIONS.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nomor Kunci</label>
                    <input
                      type="text"
                      name="keyNumber"
                      value={formData.keyNumber}
                      onChange={handleInputChange}
                      placeholder="Masukkan nomor kunci troli"
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                    />
                  </div>
                </div>

                {/* Search / Input Area */}
                <div className="mb-6 relative" ref={searchRef}>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Cari Item (Obat/BMHP)</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 sm:text-sm transition-all"
                      placeholder="Ketik nama obat atau alkes..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setShowSuggestions(true);
                        setSelectedIndex(-1);
                      }}
                      onFocus={() => {
                        setShowSuggestions(true);
                        setSelectedIndex(-1);
                      }}
                      onKeyDown={handleKeyDown}
                    />
                    {searchTerm && (
                      <button 
                        onClick={() => {
                          setSearchTerm("");
                          setSelectedIndex(-1);
                        }}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Suggestions Dropdown */}
                  {showSuggestions && searchTerm && (
                    <div 
                      ref={suggestionsContainerRef}
                      className="absolute z-40 mt-1 w-full bg-white shadow-xl max-h-60 rounded-lg py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm border border-gray-200"
                    >
                      {filteredSuggestions.length > 0 ? (
                        filteredSuggestions.map((suggestion, index) => (
                          <div
                            key={index}
                            className={`cursor-pointer select-none relative py-3 pl-10 pr-4 transition-colors border-b border-gray-50 last:border-0 ${
                              index === selectedIndex ? "bg-red-100" : "hover:bg-red-50"
                            }`}
                            onClick={() => addItem(suggestion)}
                            onMouseEnter={() => setSelectedIndex(index)}
                          >
                            <span className="block truncate font-medium text-gray-900">{suggestion}</span>
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                              <Plus className={`h-4 w-4 ${index === selectedIndex ? 'text-red-700' : 'text-red-500'}`} aria-hidden="true" />
                            </span>
                          </div>
                        ))
                      ) : (
                        <div 
                          className={`cursor-pointer select-none relative py-3 pl-10 pr-4 transition-colors text-gray-600 italic ${
                            selectedIndex === 0 ? "bg-gray-100" : "hover:bg-gray-50"
                          }`}
                          onClick={() => addItem(searchTerm)}
                          onMouseEnter={() => setSelectedIndex(0)}
                        >
                          Item tidak ditemukan. Tekan Enter untuk tambah manual "{searchTerm}"
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Summary Table */}
                <div className="border-t border-gray-100 pt-6">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center">
                    <ClipboardList className="w-4 h-4 mr-2" />
                    Ringkasan Pemakaian
                  </h3>
                  
                  {formData.items.length === 0 ? (
                    <div className="text-center py-10 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                      <p className="text-gray-400 text-sm">Belum ada item yang ditambahkan.</p>
                      <p className="text-xs text-gray-400 mt-1">Gunakan kotak pencarian di atas untuk menambah item.</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                      <table className="min-w-full divide-y divide-gray-300">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider sm:pl-6">Nama Item</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Jumlah</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Jenis</th>
                            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                              <span className="sr-only">Hapus</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {formData.items.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                              <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                                {item.name}
                              </td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={(e) => updateItem(item.id, "quantity", parseInt(e.target.value) || 0)}
                                  className="w-20 rounded border-gray-300 focus:ring-red-500 focus:border-red-500 text-sm p-1"
                                />
                              </td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                <input
                                  type="text"
                                  value={item.type}
                                  onChange={(e) => updateItem(item.id, "type", e.target.value)}
                                  className="w-40 bg-transparent border-0 border-b border-gray-200 focus:ring-0 focus:border-red-500 text-sm p-1 font-semibold text-gray-700"
                                />
                              </td>
                              <td className="whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                <button
                                  onClick={() => removeItem(item.id)}
                                  className="text-gray-400 hover:text-red-600 transition-colors p-1"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Action */}
            <div className="flex justify-end pt-4">
               <button
                onClick={handleSave}
                className="flex items-center px-10 py-4 bg-red-600 text-white rounded-xl shadow-lg hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-200 font-bold transition-all transform active:scale-95"
              >
                <Save className="w-5 h-5 mr-2" />
                Simpan Log Pemakaian
              </button>
            </div>

          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-800 flex items-center">
                <History className="w-6 h-6 mr-2 text-gray-600" />
                Riwayat Pemakaian
              </h2>
              {savedLogs.length > 0 && (
                <button
                  onClick={() => setShowExportConfirm(true)}
                  className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export PDF & Reset Riwayat
                </button>
              )}
            </div>

            {savedLogs.length > 0 && (
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      placeholder="Cari pasien, RM, dokter..."
                      value={historySearchTerm}
                      onChange={(e) => setHistorySearchTerm(e.target.value)}
                      className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                    />
                  </div>
                  
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Filter className="h-4 w-4 text-gray-400" />
                    </div>
                    <select
                      value={historyLocationFilter}
                      onChange={(e) => setHistoryLocationFilter(e.target.value)}
                      className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border bg-white"
                    >
                      <option value="">Semua Lokasi Troli</option>
                      {TROLLEY_LOCATIONS.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Calendar className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="date"
                      value={historyStartDate}
                      onChange={(e) => setHistoryStartDate(e.target.value)}
                      className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                      title="Tanggal Mulai"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Calendar className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="date"
                      value={historyEndDate}
                      onChange={(e) => setHistoryEndDate(e.target.value)}
                      className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm p-2 border"
                      title="Tanggal Akhir"
                    />
                  </div>
                </div>
              </div>
            )}
            
            {savedLogs.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
                <ClipboardList className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900">Tidak ada log ditemukan</h3>
                <p className="text-gray-500 mt-1">Mulai dengan membuat log baru.</p>
                <button
                  onClick={() => {
                    setFormData({ ...INITIAL_FORM, id: crypto.randomUUID(), serialNumber: generateSerialNumber(), timestamp: getJakartaDateTime() });
                    setActiveTab("form");
                  }}
                  className="mt-6 px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 shadow"
                >
                  Buat Log Baru
                </button>
              </div>
            ) : (
              <div className="grid gap-6">
                {filteredHistoryLogs.length === 0 ? (
                  <div className="text-center py-10 bg-gray-50 rounded-xl border border-gray-200">
                    <p className="text-gray-500">Tidak ada log yang sesuai dengan filter pencarian.</p>
                  </div>
                ) : (
                  filteredHistoryLogs.map((log) => (
                    <LogCard key={log.id} log={log} onSeal={handleSealLog} onDelete={handleDeleteLog} onNotify={showNotification} />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {logToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-center">
            <div className="bg-red-100 p-3 rounded-full inline-block mb-4">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Hapus Log Riwayat?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Apakah Anda yakin ingin menghapus log ini? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setLogToDelete(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={confirmDeleteLog}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 shadow-sm transition-colors"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Confirmation Modal */}
      {showExportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Konfirmasi Ekspor & Reset</h3>
            <p className="text-gray-600 mb-6">
              Apakah Anda yakin ingin mengekspor semua data ke PDF dan <strong>menghapus seluruh riwayat</strong> dari database? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowExportConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleExportPDFs}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center"
              >
                <Download className="w-4 h-4 mr-2" />
                Ya, Ekspor & Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);