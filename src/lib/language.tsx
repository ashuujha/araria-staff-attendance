import {
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
export type Language = "hi" | "en";
const english: Record<string, string> = {
  अवलोकन: "Overview",
  उपस्थिति: "Attendance",
  "कर्मी प्रबंधन": "Staff directory",
  पंचायतें: "Panchayats",
  रिपोर्ट: "Reports",
  "गूगल शीट": "Google Sheets",
  "उपस्थिति लोड नहीं हुई। दोबारा कोशिश करें।":
    "Attendance could not be loaded. Please try again.",
  "GPS सटीकता 50 मीटर से अधिक है। खुले स्थान में दोबारा कोशिश करें।":
    "GPS accuracy exceeds 50 metres. Move outdoors and try again.",
  "कैमरा और लोकेशन चालू करें।": "Enable camera and location access.",
  "कैप्चर की समय सीमा समाप्त। दोबारा कैमरा खोलें।":
    "The capture has expired. Open the camera again.",
  "यह केवल पूर्वावलोकन है। वास्तविक उपस्थिति के लिए लॉगिन करें।":
    "This is a preview. Sign in to record actual attendance.",
  "पहले गोपनीयता सूचना स्वीकार करें।":
    "Please accept the privacy notice first.",
  "CL/SL प्रमाण अपलोड करें।": "Upload your CL/SL supporting document.",
  "ताज़ा GPS फोटो लें।": "Take a fresh GPS photo.",
  "फ़ाइल अपलोड विफल। फिर कोशिश करें।": "Upload failed. Please try again.",
  "उपस्थिति सुरक्षित दर्ज हो गई।": "Your attendance has been recorded.",
  "वास्तविक बदलाव के लिए एडमिन लॉगिन करें।":
    "Sign in as an administrator to make changes.",
  "बदलाव सुरक्षित दर्ज है।": "Your changes have been saved.",
  "मेनू बंद करें": "Close menu",
  अररिया: "Araria",
  "कर्मी उपस्थिति पोर्टल": "Staff attendance portal",
  "पंचायती राज विभाग": "Panchayati Raj Department",
  कार्यस्थल: "Workspace",
  "मुख्य नेविगेशन": "Main navigation",
  "मेरी उपस्थिति": "My attendance",
  "सुरक्षित एवं निजी": "Secure and private",
  सेटिंग्स: "Settings",
  प्र: "P",
  पूर्वावलोकन: "Preview",
  "लॉगिन / लॉगआउट": "Sign in / Sign out",
  "मेनू खोलें": "Open menu",
  "प्रखंड पंचायत राज कार्यालय": "Block Panchayati Raj Office",
  ऑनलाइन: "Online",
  ऑफ़लाइन: "Offline",
  "रात्रि मोड": "Dark mode",
  "दिन मोड": "Light mode",
  रात्रि: "Dark",
  दिन: "Light",
  सूचनाएँ: "Notifications",
  अ: "A",
  "पूर्वावलोकन मोड": "Preview workspace",
  "· उदाहरण डेटा। वास्तविक कर्मी जानकारी सुरक्षित है।":
    "· Sample records. Personal staff information stays private.",
  "सुरक्षित कार्यस्थल": "Secure workspace",
  "· सभी समय सर्वर से दर्ज होते हैं।":
    "· All times are recorded by the server.",
  "लॉगिन करें": "Sign in",
  "आज की उपस्थिति": "Attendance overview",
  "उपस्थिति रजिस्टर": "Attendance register",
  "पंचायत एवं कार्यस्थल": "Panchayats & worksites",
  "रिपोर्ट एवं निर्यात": "Reports & exports",
  "गूगल शीट समन्वयन": "Google Sheets sync",
  "मेरी दैनिक उपस्थिति": "My daily attendance",
  "सेटिंग्स एवं सहायता": "Settings & help",
  "अपने प्रखंड की उपस्थिति, एक नज़र में।":
    "A clear view of attendance across your block.",
  "लोकेशन सत्यापित करें, कैमरे से फोटो लें और उपस्थिति दर्ज करें।":
    "Verify your location, take a photo and record your attendance.",
  "अररिया प्रखंड · पंचायती राज विभाग":
    "Araria block · Panchayati Raj Department",
  "उपस्थिति की तिथि": "Attendance date",
  निर्यात: "Export",
  "कर्मी आयात करें": "Import staff",
  उपस्थित: "Present",
  "कुल कर्मियों का 76.9%": "76.9% of registered staff",
  "आज पंच इन किए": "Punched in today",
  अनुपस्थित: "Absent",
  "अभी तक उपस्थिति दर्ज नहीं": "No attendance recorded yet",
  "अवकाश पर": "On leave",
  "CL / SL प्रमाण सहित": "With CL / SL documentation",
  "पंच आउट बाकी": "Awaiting punch out",
  "पंच इन दर्ज हो चुका है": "Punch in already recorded",
  "पंचायतवार स्थिति": "Panchayat attendance",
  "सभी देखें": "View all",
  अवकाश: "Leave",
  "30 ग्राम पंचायतें + प्रखंड कार्यालय": "30 gram panchayats + block office",
  "ध्यान देने योग्य": "Needs attention",
  "लोकेशन की समीक्षा": "Location review",
  "2 रिकॉर्ड सत्यापन के लिए चिह्नित": "2 records require verification",
  "सत्यापन किए गए रिकॉर्ड यहाँ दिखेंगे": "Records for verification appear here",
  "कर्मी विवरण सुधारें": "Review staff details",
  "2 पहचान में नाम का अंतर · Needs fix": "2 identities have conflicting names",
  "गूगल शीट जोड़ें": "Connect Google Sheets",
  "समन्वयन सेटअप अभी बाकी है": "Sync configuration is pending",
  "हर सुधार का ऑडिट लॉग रखा जाता है":
    "Every correction is recorded in the audit log",
  "आज का उपस्थिति रजिस्टर": "Attendance register",
  "उपस्थिति विवरण": "Attendance details",
  "चिह्नित रिकॉर्ड": "Flagged records",
  "कर्मी का नाम या मोबाइल खोजें…": "Search by staff name or phone…",
  "कर्मी खोजें": "Search staff",
  "पंचायत फ़िल्टर": "Filter by panchayat",
  "सभी पंचायतें": "All panchayats",
  "स्थिति फ़िल्टर": "Filter by status",
  "सभी स्थितियाँ": "All statuses",
  चिह्नित: "Flagged",
  "फ़िल्टर साफ़ करें": "Clear filters",
  "कर्मी का नाम": "Staff member",
  "पंचायत / पद": "Panchayat / Position",
  "पंच इन": "Punch in",
  "पंच आउट": "Punch out",
  लोकेशन: "Location",
  स्थिति: "Status",
  क: "S",
  "समीक्षा बाकी": "Review pending",
  विवरण: "Details",
  "कोई रिकॉर्ड नहीं मिला": "No records found",
  "फ़िल्टर बदलें या दूसरी तिथि चुनें।":
    "Try different filters or choose another date.",
  रिकॉर्ड: "records",
  पिछला: "Previous",
  अगला: "Next",
  "आयात के लिए तैयार": "ready to import",
  "रिक्त पद छोड़े गए": "vacant positions skipped",
  "पहचान की समीक्षा": "identities to review",
  "कर्मी सूची एवं आयात": "Staff directory & import",
  "व्यक्तिगत जानकारी सुरक्षित है": "Personal information stays private",
  "वास्तविक नाम, फोन और आयात फ़ाइल केवल अधिकृत एडमिन को उपलब्ध होंगे। पूर्वावलोकन में व्यक्तिगत डेटा नहीं दिखता।":
    "Real names, phone numbers and import files are available only to authorized administrators. The preview contains no personal staff data.",
  "पंचायतें ·": "panchayats ·",
  सक्रिय: "Active",
  निष्क्रिय: "Inactive",
  सुधारें: "Edit",
  "आयात समीक्षा": "Import review",
  "Excel की 410 डेटा पंक्तियाँ पढ़ी गईं": "410 workbook data rows reviewed",
  "एक ही फोन की पंचायत नियुक्तियाँ जोड़ी गईं":
    "Panchayat assignments merged by unique phone",
  "59 रिक्त पद हटाए गए": "59 vacant positions skipped",
  "2 अलग नाम वाली पहचान रोककर समीक्षा सूची में रखी गईं":
    "2 conflicting identities held for review",
  "आयात निर्देश देखें": "View import instructions",
  "जियोफेंस सेटअप बाकी है": "Geofence setup pending",
  "पंचायतों के सत्यापित निर्देशांक मिलने तक वास्तविक पंच बंद रहेंगे। प्रत्येक कार्यस्थल का प्रारंभिक दायरा 300 मीटर है।":
    "Live punches remain disabled until verified worksite coordinates are configured. The default radius is 300 metres.",
  "जियोफेंस तैयार": "Geofence ready",
  "निर्देशांक बाकी": "Coordinates pending",
  "जियोफेंस देखें": "View geofence",
  "दैनिक उपस्थिति": "Daily attendance",
  "पंचायतवार रिपोर्ट": "Panchayat report",
  "पंच इन बाकी": "Missing punches",
  "संदिग्ध रिकॉर्ड": "Flagged attendance",
  "चुनी गई तिथि:": "Selected date:",
  "CSV डाउनलोड": "Download CSV",
  "PDF के रूप में सहेजें": "Save as PDF",
  "उपस्थिति रजिस्टर खोलें और ब्राउज़र में प्रिंट → PDF चुनें।":
    "Open the attendance register, then choose Print → Save as PDF in your browser.",
  "प्रिंट / PDF": "Print / PDF",
  "सेटअप बाकी": "Setup pending",
  "आपकी रिपोर्ट, अपने आप अपडेट।": "Your reporting, automatically updated.",
  "Google Sheet जोड़ने पर दैनिक उपस्थिति की सुरक्षित कॉपी अपने आप समन्वयित होगी। मूल रिकॉर्ड डेटाबेस में रहेंगे।":
    "Connect a Google Sheet to sync a protected attendance mirror. The database remains the source of truth.",
  "हर महीने अलग टैब": "One tab for each month",
  "पंच आउट पर वही पंक्ति अपडेट": "Punch out updates the same row",
  "विफलता पर दोबारा प्रयास": "Automatic retry after failures",
  "सेटअप निर्देश": "Setup instructions",
  "अंतिम समन्वयन: अभी तक नहीं · Database is the source of truth":
    "Last synced: never · Database is the source of truth",
  "पोर्टल की जानकारी": "Portal information",
  "समय क्षेत्र": "Time zone",
  "Asia/Kolkata · समय सर्वर से": "Asia/Kolkata · Server-recorded time",
  "स्थान सत्यापन": "Location verification",
  "ताज़ा GPS · अधिकतम सटीकता 50 मीटर":
    "Fresh GPS · Maximum accuracy radius 50 metres",
  जियोफेंस: "Geofence",
  "प्रत्येक पंचायत का दायरा 300 मीटर": "Default worksite radius: 300 metres",
  फोटो: "Photo",
  "लाइव कैमरा · समय और GPS वॉटरमार्क": "Live camera · Time and GPS watermark",
  "एडमिन संपर्क": "Administrator contact",
  स्टोरेज: "Storage",
  "निजी · सीमित समय के हस्ताक्षरित लिंक": "Private · Time-limited signed links",
  "गोपनीयता सूचना": "Privacy notice",
  "कर्मी सहायता": "Staff help",
  "उदाहरण कर्मी · पूर्वावलोकन": "Sample staff · Preview",
  "सर्वर समय": "Server time",
  "गोपनीयता एवं सहमति": "Privacy & consent",
  "उपस्थिति सत्यापन के लिए आपकी लाइव फोटो, स्थान, समय एवं डिवाइस जानकारी सुरक्षित रखी जाएगी। केवल अधिकृत अधिकारी इसे देख सकते हैं।":
    "Your live photo, location, time and device information are stored privately to verify attendance. Only authorized officials can access them.",
  "मैंने सूचना पढ़ी और स्वीकार की है।": "I have read and accept this notice.",
  "नाम / Name": "Name",
  "उदाहरण कर्मी": "Sample staff",
  "पद / Position": "Position",
  "पंचायत सचिव": "Panchayat Secretary",
  "विभाग / Department": "Department",
  "कार्यस्थल / Panchayat": "Worksite / Panchayat",
  "अवकाश पर हूँ / On leave (CL / SL)": "I am on leave (CL / SL)",
  "CL / SL प्रमाण अपलोड करें": "Upload CL / SL documentation",
  "PDF, JPG या PNG · अधिकतम 5 MB": "PDF, JPG or PNG · Maximum 5 MB",
  "फ़ाइल 5 MB से छोटी रखें।": "Choose a file smaller than 5 MB.",
  "फोटो लें": "Take photo",
  "कैप्चर की गई GPS फोटो": "Captured GPS photo",
  "दोबारा लें": "Retake photo",
  "कैमरे से ताज़ा फोटो लें": "Take a fresh camera photo",
  "समय और स्थान फोटो पर दर्ज होंगे।":
    "Time and location will be recorded on the photo.",
  "अनुमति जाँच रहे हैं…": "Checking permissions…",
  "कैमरा एवं GPS खोलें": "Open camera & GPS",
  "आपका वर्तमान स्थान": "Your current location",
  "सटीकता ±": "Accuracy ±",
  मीटर: "metres",
  "फोटो लेने पर GPS अपने आप प्राप्त होगा। लोकेशन अनुमति चालू रखें।":
    "GPS is captured automatically with your photo. Keep location permission enabled.",
  "लोकेशन टाइप या पेस्ट नहीं की जा सकती": "Location cannot be typed or pasted",
  "अवकाश दर्ज करें": "Submit leave",
  "पंच इन / Punch in": "Punch in",
  "पंच आउट / Punch out": "Punch out",
  "अवकाश दर्ज है।": "Leave has been recorded.",
  "· पंच आउट दर्ज है।": "· Punch out recorded.",
  "· पंच आउट बाकी है।": "· Punch out pending.",
  "एक दिन में एक पंच इन और एक पंच आउट। जमा करने के बाद बदलाव केवल एडमिन कर सकते हैं।":
    "One punch in and one punch out per day. Only an administrator can correct a submitted record.",
  "सुरक्षित उपस्थिति, बेहतर जवाबदेही":
    "Verified attendance. Clear accountability.",
  "समय क्षेत्र: IST (UTC +05:30)": "Time zone: IST (UTC +05:30)",
  "संदेश बंद करें": "Dismiss message",
  लॉगिन: "Sign in",
  "बंद करें": "Close",
  "उपस्थिति पोर्टल में प्रवेश": "Sign in to your workspace",
  "कर्मी / Staff": "Staff",
  "एडमिन / Admin": "Administrator",
  "मोबाइल या ईमेल": "Phone number or email",
  "एडमिन ईमेल": "Administrator email",
  "10 अंकों का मोबाइल या ईमेल": "10-digit phone number or email",
  पासवर्ड: "Password",
  "अपना पासवर्ड दर्ज करें": "Enter your password",
  "प्रवेश हो रहा है…": "Signing in…",
  "सुरक्षित लॉगिन": "Sign in securely",
  "लॉगिन सहायता: sfc.aditya@gmail.com": "Sign-in help: sfc.aditya@gmail.com",
  पद: "Position",
  समीक्षा: "Review",
  "कोई चिह्न नहीं": "No flags",
  "उदाहरण रिकॉर्ड। इसमें वास्तविक फोटो या कर्मी विवरण नहीं हैं।":
    "Sample record. No real staff photos or personal information are included.",
  "निजी फोटो केवल अधिकृत कर्मी एवं एडमिन देख सकते हैं।":
    "Private photos are accessible only to authorized staff and administrators.",
  "पंच इन फोटो": "Punch-in photo",
  "पंच आउट फोटो": "Punch-out photo",
  "अवकाश प्रमाण": "Leave document",
  "पंच इन (IST)": "Punch in (IST)",
  "पंच आउट (IST)": "Punch out (IST)",
  "सुधार कारण": "Reason for correction",
  "सुधार सुरक्षित करें": "Save correction",
  "सत्यापित अक्षांश और देशांतर एडमिन सेटअप में आवश्यक हैं। अनुमानित निर्देशांक इस्तेमाल नहीं किए जाते।":
    "Verified latitude and longitude are required. Coordinates are never guessed.",
  "प्रारंभिक दायरा": "Default radius",
  "300 मीटर": "300 metres",
  "निर्देशांक बाकी · पंच बंद": "Coordinates pending · Punches disabled",
  अक्षांश: "Latitude",
  देशांतर: "Longitude",
  "दायरा (मीटर)": "Radius (metres)",
  "बदलाव का कारण": "Reason for change",
  "जियोफेंस सुरक्षित करें": "Save geofence",
  नाम: "Name",
  मोबाइल: "Phone number",
  "खाता सक्रिय": "Account active",
  "डिवाइस बाइंडिंग रीसेट करें": "Reset device binding",
  "बदलाव सुरक्षित करें": "Save changes",
  "Google Sheets सेटअप": "Google Sheets setup",
  "Google Cloud में Sheets API चालू करें।":
    "Enable the Sheets API in Google Cloud.",
  "सेवा खाते के ईमेल को शीट का Editor बनाएँ।":
    "Share the sheet with the service account as an Editor.",
  "Vercel में Sheet ID और सेवा खाते की credentials सेट करें।":
    "Set the Sheet ID and service-account credentials in Vercel.",
  "संरक्षित sync endpoint को प्रति मिनट चलाएँ।":
    "Schedule the protected sync endpoint every minute.",
  "शीट में परिवर्तन मूल उपस्थिति को नहीं बदलते।":
    "Sheet edits do not change the original attendance records.",
  "सुरक्षित कर्मी आयात": "Secure staff import",
  "स्रोत workbook का निजी आयात तैयार है। 242 खाते तैयार हैं; दो पहचान की समीक्षा करें।":
    "The private workbook import is ready. 242 accounts are ready; two conflicting identities need review.",
  "Supabase schema लागू करें।": "Apply the Supabase database schema.",
  "सर्वर की service-role key सेट करें।":
    "Set the server-only Supabase secret key.",
  "सर्वर की Supabase secret key सेट करें।":
    "Set the server-only Supabase secret key.",
  "निजी import फ़ाइल को समीक्षा करके seed script चलाएँ।":
    "Review the private import file, then run the seed script.",
  "बनी credentials फ़ाइल केवल अधिकृत कर्मियों तक पहुँचाएँ।":
    "Share generated credentials only with authorized staff.",
  "किसी भी credential फ़ाइल को सार्वजनिक repository में न रखें।":
    "Do not commit credential files to a public repository.",
  "उपस्थिति के लिए GPS फोटो, वर्तमान स्थान, समय, नेटवर्क एवं डिवाइस संकेत लिए जाते हैं। जानकारी निजी डेटाबेस और स्टोरेज में रखी जाती है। अधिकृत एडमिन सत्यापन और आवश्यक सुधार कर सकते हैं।":
    "GPS photos, current location, time, network and device signals are collected for attendance verification. Data is stored in a private database and storage. Authorized administrators may verify and correct records.",
  "डेटा कम से कम एक वर्ष रखा जाएगा। पूछताछ: sfc.aditya@gmail.com।":
    "Data will be retained for at least one year. Contact: sfc.aditya@gmail.com.",
  "Google Sheet सेटअप बाकी है। दो आयात पहचान की समीक्षा आवश्यक है। पंचायतों के निर्देशांक सेट करने के बाद वास्तविक पंच चालू होंगे।":
    "Google Sheets setup is pending. Two imported identities need review. Live punches require verified panchayat coordinates.",
  "अपने मोबाइल या ईमेल एवं पासवर्ड से लॉगिन करें।":
    "Sign in with your phone number or email and password.",
  "अपनी नियुक्त पंचायत चुनें।": "Select your assigned panchayat.",
  "लोकेशन और कैमरे की अनुमति दें, ताज़ा फोटो लें।":
    "Allow location and camera access, then take a fresh photo.",
  "पंच इन करें; कार्यालय छोड़ते समय नई फोटो लेकर पंच आउट करें।":
    "Punch in. Take a new photo and punch out when leaving work.",
  "अवकाश पर हों तो CL / SL प्रमाण अपलोड करें।":
    "Upload CL / SL documentation when you are on leave.",
  "ऑफ़लाइन होने पर उपस्थिति जमा नहीं होती। नेटवर्क आने पर दोबारा प्रयास करें।":
    "Attendance cannot be submitted offline. Try again when your connection returns.",
  लेखापाल: "Accountant",
  "तकनीकी सहायक": "Technical Assistant",
  "पंचायत कार्यपालक सहायक": "Executive Assistant",
  "कचहरी सचिव": "Kachahari Secretary",
  "विकास मित्र": "Vikas Mitra",
  "स्थान समीक्षा": "Location review",
  "नई डिवाइस": "New device",
  पोखरिया: "Pokharia",
  "अररिया बस्ती": "Araria Basti",
  बसंतपुर: "Basantpur",
  बाँसबाड़ी: "Bansbari",
  हड़िया: "Haria",
  हयातपुर: "Hayatpur",
  "रामपुर कोदरकट्टी": "Rampur Kodarkatti",
  चातर: "Chatar",
  कुसियारगाँव: "Kusiyargaon",
  गैड़ा: "Gaira",
  चिकनी: "Chikni",
  पैकटोला: "Paiktola",
  झमटा: "Jhamta",
  बोची: "Bochi",
  "मदनपुर पूर्वी": "Madanpur East",
  चंद्रदेई: "Chandradei",
  कमलदाहा: "Kamaldaha",
  बनगामा: "Bangama",
  बेलवा: "Belwa",
  गैयारी: "Gaiyari",
  दियारी: "Diari",
  जमुआ: "Jamua",
  "तरौना भोजपुर": "Tarauna Bhojpur",
  शरणपुर: "Sharanpur",
  "किस्मत खवासपुर": "Kismat Khawaspur",
  बटुरबाड़ी: "Baturbari",
  साहसमल: "Sahasmal",
  "रामपुर मोहनपुर पूर्वी": "Rampur Mohanpur East",
  "रामपुर मोहनपुर पश्चिम": "Rampur Mohanpur West",
  "मदनपुर पश्चिम": "Madanpur West",
  "प्रखंड पंचायत राज कार्यालय, अररिया": "Block Panchayati Raj Office, Araria",
  "लाइव पोर्टल सेटअप बाकी है। एडमिन से Supabase कॉन्फ़िगरेशन पूरा करवाएँ।":
    "Live portal setup is pending. Ask your administrator to complete Supabase configuration.",
  "अनुरोध पूरा नहीं हुआ। फिर कोशिश करें या एडमिन से संपर्क करें।":
    "The request could not be completed. Try again or contact your administrator.",
  "अनुरोध का स्रोत मान्य नहीं है।": "The request origin is not allowed.",
  "कृपया लॉगिन करें।": "Please sign in.",
  "सत्र समाप्त हो गया। फिर लॉगिन करें।":
    "Your session has expired. Please sign in again.",
  "फ़ाइल सुरक्षा जाँच का सेटअप बाकी है।":
    "File security scanning has not been configured.",
  "फ़ाइल सुरक्षा जाँच का सेटअप बाकी है। एडमिन से संपर्क करें।":
    "File scanning setup is pending. Contact your administrator.",
};
Object.assign(english, {
  "तिथि अमान्य।": "Invalid date.",
  "सुधार का स्पष्ट कारण लिखें (10–1000 अक्षर)।":
    "Enter a clear reason for the correction (10–1000 characters).",
  "जियोफेंस बदलने के लिए Super Admin आवश्यक।":
    "Only a Super Admin can change geofences.",
  "निर्देशांक या दायरा अमान्य।": "Invalid coordinates or radius.",
  "कार्रवाई अमान्य।": "Invalid action.",
  "पंच केवल कर्मी खाते से करें।": "Use a staff account to record attendance.",
  "अनुरोध अमान्य।": "Invalid request.",
  "पंचायत या कार्रवाई अमान्य है।": "Invalid panchayat or action.",
  "अपलोड सत्यापन अमान्य।": "Invalid upload verification.",
  "अपलोड समय सीमा समाप्त। फिर कोशिश करें।":
    "Your upload has expired. Please try again.",
  "अपलोड पूरा नहीं हुआ।": "Your upload is incomplete.",
  "मान्य GPS JPEG फोटो या अवकाश PDF/JPG/PNG दें।":
    "Provide a valid GPS JPEG photo or a PDF/JPG/PNG leave document.",
  "ताज़ा कैमरा सत्यापन आवश्यक है।": "A fresh camera verification is required.",
  "फ़ाइल की सुरक्षा जाँच सफल नहीं हुई।":
    "The file did not pass the security scan.",
  "फोटो सुरक्षित नहीं हुई। फिर कोशिश करें।":
    "The photo could not be saved. Please try again.",
  "मोबाइल/ईमेल और पासवर्ड जाँचें।":
    "Check your phone number or email and password.",
  "मान्य 10 अंकों का मोबाइल नंबर डालें।":
    "Enter a valid 10-digit phone number.",
  "मोबाइल/ईमेल या पासवर्ड गलत है।":
    "Incorrect phone number, email or password.",
  "इस कार्यस्थल में प्रवेश की अनुमति नहीं है।":
    "You do not have access to this workspace.",
  "फ़ाइल अनुरोध अमान्य।": "Invalid file request.",
  "फ़ाइल नहीं मिली।": "File not found.",
  "कर्मी एवं सुधार कारण आवश्यक।": "Select a staff member and provide a reason.",
  "कर्मी प्रबंधन की अनुमति नहीं।":
    "You do not have permission to manage this staff member.",
  "Super Admin आवश्यक।": "Super Admin access is required.",
  "ईमेल खाते का पासवर्ड Supabase Admin से रीसेट करें।":
    "Reset email-account passwords through Supabase Admin.",
  "केवल कर्मी फोटो अपलोड कर सकते हैं।":
    "Only staff members can upload attendance photos.",
  "मान्य फ़ाइल चुनें (अधिकतम 5 MB)।": "Choose a valid file (maximum 5 MB).",
  "खाता निष्क्रिय या अपूर्ण है।": "Your account is inactive or incomplete.",
  "डिवाइस पंजीकरण आवश्यक है। फिर लॉगिन करें।":
    "Device registration is required. Please sign in again.",
  "यह कार्रवाई केवल अधिकृत एडमिन के लिए है।":
    "This action requires administrator access.",
  "बहुत अधिक प्रयास। 15 मिनट बाद कोशिश करें।":
    "Too many attempts. Try again in 15 minutes.",
  "डेटाबेस अनुरोध विफल। कॉन्फ़िगरेशन जाँचें।":
    "Database request failed. Please check the configuration.",
  "खाता निष्क्रिय है।": "Your account is inactive.",
  "यह खाता दूसरे डिवाइस से जुड़ा है। एडमिन से रीसेट करवाएँ।":
    "This account is bound to another device. Ask an administrator to reset it.",
  "आज की उपस्थिति पहले से दर्ज है।":
    "Your attendance for today has already been recorded.",
  "पंच आउट से पहले पंच इन आवश्यक है; दोबारा पंच आउट नहीं हो सकता।":
    "Punch in before punching out. A second punch out is not allowed.",
  "पंच आउट उसी पंचायत से करें जहाँ पंच इन किया था।":
    "Punch out from the same panchayat where you punched in.",
  "लोकेशन चालू करें। GPS सटीकता 50 मीटर से कम आवश्यक है।":
    "Enable location. GPS accuracy must be within 50 metres.",
  "कैमरा सत्यापन समाप्त या अमान्य है। नई फोटो लें।":
    "Camera verification has expired or is invalid. Take a new photo.",
  "पंचायत का जियोफेंस सेटअप बाकी है।":
    "This panchayat's geofence is not configured.",
  "आप नियुक्त कार्यस्थल के दायरे से बाहर हैं।":
    "You are outside your assigned worksite radius.",
  "ताज़ा GPS फोटो आवश्यक है।": "A fresh GPS photo is required.",
  "इस फोटो का पहले उपयोग हो चुका है। नई फोटो लें।":
    "This photo has already been used. Take a new photo.",
  "फोटो मिलती-जुलती है। दोबारा कैमरे से नई फोटो लें।":
    "This photo resembles a previous capture. Take a new camera photo.",
  "स्थान में असामान्य बदलाव है। एडमिन से संपर्क करें।":
    "An unusual change in location was detected. Contact your administrator.",
  "रिकॉर्ड नहीं मिला।": "Record not found.",
  "सुधार की अनुमति नहीं है।":
    "You do not have permission to correct this record.",
  "सुधार का कारण आवश्यक है।": "A reason for the correction is required.",
  "केवल पंच समय सुधारे जा सकते हैं।": "Only punch times can be corrected.",
  "खाता या डिवाइस मान्य नहीं है।":
    "Your account or registered device is invalid.",
  "पंचायत नियुक्ति मान्य नहीं है।": "This panchayat is not assigned to you.",
  "फ़ाइल का स्वामी अमान्य है।": "Invalid file ownership.",
  "कैमरा फोटो बहुत छोटी है।": "The camera photo is too small.",
  "स्थान अमान्य या सटीकता 50 मीटर से अधिक है।":
    "Invalid location or GPS accuracy worse than 50 metres.",
});
Object.assign(english, {
  "मास्टर डेटा — कर्मी": "Master data — Staff",
  "नियुक्त कार्यस्थल, पद और संपर्क विवरण":
    "Assigned worksites, positions and contact details",
  "एक कर्मी, एक दैनिक रिकॉर्ड": "One staff member, one daily record",
  "कई कार्यस्थल चुनें। किसी एक स्थल पर दर्ज उपस्थिति सभी नियुक्त पंचायतों में दिखाई जाएगी।":
    "Assign multiple worksites. Attendance entered once appears in every assigned panchayat.",
  "नया कर्मी जोड़ें": "Add staff member",
  "कर्मी जोड़ें": "Add staff member",
  हटाएँ: "Delete",
  "कर्मी हटाएँ": "Delete staff member",
  "उपस्थिति हटाएँ": "Delete attendance",
  "हटाने की पुष्टि करें": "Confirm deletion",
  "हटाने का कारण": "Reason for deletion",
  "रिकॉर्ड सामान्य सूची से हट जाएगा। पुराना डेटा और हटाने का कारण ऑडिट में सुरक्षित रहेगा।":
    "This record will be removed from the active list. Its history and deletion reason will remain in the audit log.",
  "अभी कोई कर्मी दर्ज नहीं है": "No staff members yet",
  "नया कर्मी जोड़कर उसकी नियुक्त पंचायतें चुनें।":
    "Add a staff member and select their assigned panchayats.",
  "ईमेल (वैकल्पिक)": "Email (optional)",
  "नियुक्त कार्यस्थल / पंचायतें": "Assigned worksites / panchayats",
  "एक या अधिक कार्यस्थल चुनें। एक बार की उपस्थिति सभी चुने हुए स्थलों में दिखेगी।":
    "Select one or more worksites. One attendance entry will appear in every selected worksite.",
  "कम से कम एक कार्यस्थल चुनें।": "Select at least one worksite.",
  "सुरक्षित कर रहे हैं…": "Saving…",
  "उपस्थिति दर्ज करें": "Enter attendance",
  "एडमिन द्वारा उपस्थिति दर्ज करें": "Administrator attendance entry",
  "एडमिन द्वारा दर्ज उपस्थिति अलग चिह्नित होगी। उसी दिन का रिकॉर्ड मौजूद हो तो उसका डेटा अपडेट होगा।":
    "Manual attendance is clearly marked as administrator-entered. If a record already exists for that day, its data will be updated.",
  "कर्मी चुनें": "Select staff member",
  तिथि: "Date",
  "दर्ज करने का कार्यस्थल": "Recording worksite",
  "इन सभी कार्यस्थलों में यही डेटा दिखेगा":
    "The same data will appear at all these worksites",
  "उपस्थिति दर्ज करने का कारण": "Reason for manual attendance",
  "उपस्थिति सुरक्षित करें": "Save attendance",
  "सभी नियुक्त कार्यस्थल": "All assigned worksites",
  "सभी नियुक्त स्थल:": "All assigned worksites:",
  "एडमिन द्वारा दर्ज": "Administrator-entered",
  "नए खाते का पासवर्ड": "New account password",
  "कर्मी खाता बन गया": "Staff account created",
  "यह पासवर्ड केवल अभी दिखाया जा रहा है। कर्मी तक सुरक्षित पहुँचाएँ।":
    "This password is shown only now. Share it securely with the staff member.",
  "यह मोबाइल पहले से दर्ज है।": "This phone number is already registered.",
  "कार्यस्थल, पद या विभाग अमान्य है।":
    "Invalid worksite, position or department.",
  "एक कार्यस्थल दो बार नहीं चुन सकते।":
    "You cannot assign the same worksite twice.",
  "कर्मी विवरण या कारण अमान्य है।": "Invalid staff details or reason.",
  "कर्मी हटाने की अनुमति नहीं।":
    "You do not have permission to delete this staff member.",
  "हटाने का कारण आवश्यक है।": "A reason for deletion is required.",
  "कर्मी पहले से हटाया गया है।": "This staff member has already been deleted.",
  "उपस्थिति दर्ज करने की अनुमति नहीं।":
    "You do not have permission to enter attendance.",
  "उपस्थिति दर्ज करने का कारण आवश्यक है।":
    "A reason for manual attendance is required.",
  "तिथि, स्थिति या कार्यस्थल अमान्य है।": "Invalid date, status or worksite.",
  "पंच समय और तिथि जाँचें।": "Check the punch times and attendance date.",
  "उपस्थिति हटाने की अनुमति नहीं।":
    "You do not have permission to delete attendance.",
  "रिकॉर्ड पहले से हटाया गया है।": "This record has already been deleted.",
});
const normalized = Object.fromEntries(
  Object.entries(english).map(([key, value]) => [key.normalize("NFC"), value]),
);
export function translateText(value: string, language: Language): string {
  if (language === "hi") return value;
  const key = value.replace(/\s+/g, " ").trim().normalize("NFC");
  if (normalized[key])
    return (
      (value.match(/^\s+/)?.[0] || "") +
      normalized[key] +
      (value.match(/\s+$/)?.[0] || "")
    );
  const sample = key.match(/^उदाहरण कर्मी (\d+)$/);
  if (sample) return `Sample staff ${sample[1]}`;
  // Dynamic counts and snippets keep their numeric values, while using translated labels.
  return value
    .replace(/पंच इन:/g, "Punch in:")
    .replace(/पंच आउट:/g, "Punch out:")
    .replace(/विवरण/g, "details")
    .replace(/रिकॉर्ड/g, "records");
}
/** Localize rendered copy and accessible labels, preserving event handlers and form data. */
export function localizeContent(
  node: ReactNode,
  language: Language,
): ReactNode {
  if (language === "hi") return node;
  if (typeof node === "string") return translateText(node, language);
  if (Array.isArray(node))
    return node.map((child) => localizeContent(child, language));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.props.translate === "no") return element;
  const props: Record<string, unknown> = {};
  for (const key of ["aria-label", "title", "placeholder", "alt"])
    if (typeof element.props[key] === "string")
      props[key] = translateText(element.props[key] as string, language);
  // Display names may be translated, but server-side panchayat/status values stay canonical.
  if (
    element.type === "option" &&
    element.props.value === undefined &&
    typeof element.props.children === "string"
  )
    props.value = element.props.children;
  if (element.props.children !== undefined)
    props.children = localizeContent(
      element.props.children as ReactNode,
      language,
    );
  return cloneElement(element, props);
}
