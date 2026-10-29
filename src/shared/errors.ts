// Stable database error codes → user messages (en / mr / hi). The RPCs raise these codes in
// the error message (see migration 0006 header). SHARED with the mobile app.

export type Lang = 'en' | 'mr' | 'hi';

type Messages = Record<Lang, string>;

export const ERROR_MESSAGES: Record<string, Messages> = {
  AUTH_REQUIRED: { en: 'Please sign in again.', mr: 'कृपया पुन्हा साइन इन करा.', hi: 'कृपया फिर से साइन इन करें।' },
  ACCOUNT_INACTIVE: { en: 'This account has been deactivated. Contact the college office.', mr: 'हे खाते निष्क्रिय केले आहे. कार्यालयाशी संपर्क साधा.', hi: 'यह खाता निष्क्रिय है। कार्यालय से संपर्क करें।' },
  ATT_FORBIDDEN: { en: 'You do not have permission to do this.', mr: 'हे करण्याची परवानगी आपल्याला नाही.', hi: 'आपको यह करने की अनुमति नहीं है।' },
  ATT_NOT_FOUND: { en: 'The register or session was not found.', mr: 'हजेरी पत्रक किंवा तास सापडला नाही.', hi: 'रजिस्टर या सत्र नहीं मिला।' },
  ATT_FUTURE_DATE: { en: 'Attendance cannot be marked for a future date.', mr: 'भविष्यातील तारखेची हजेरी नोंदवता येत नाही.', hi: 'भविष्य की तारीख की हाज़िरी नहीं लगाई जा सकती।' },
  ATT_TOO_EARLY: { en: 'Marking opens 15 minutes before the period starts.', mr: 'तास सुरू होण्याच्या 15 मिनिटे आधी हजेरी सुरू होते.', hi: 'पीरियड शुरू होने से 15 मिनट पहले हाज़िरी खुलती है।' },
  ATT_INVALID_STATUS: { en: 'One of the statuses is not allowed here.', mr: 'यापैकी एक स्थिती येथे चालत नाही.', hi: 'इनमें से एक स्थिति यहाँ मान्य नहीं है।' },
  ATT_DUPLICATE_STUDENT: { en: 'A student appears twice in the submission.', mr: 'एक विद्यार्थी दोनदा नोंदवला आहे.', hi: 'एक छात्र दो बार दर्ज है।' },
  ATT_STUDENT_NOT_IN_ROSTER: { en: 'A student is not on this roster. Refresh the roster and try again.', mr: 'एक विद्यार्थी या यादीत नाही. यादी रीफ्रेश करा.', hi: 'एक छात्र इस सूची में नहीं है। सूची रीफ्रेश करें।' },
  ATT_NO_RECORDS: { en: 'Choose at least one student.', mr: 'किमान एक विद्यार्थी निवडा.', hi: 'कम से कम एक छात्र चुनें।' },
  ATT_LOCKED: { en: 'This register is locked. Request a correction instead.', mr: 'हे हजेरी पत्रक बंद झाले आहे. दुरुस्तीची विनंती करा.', hi: 'यह रजिस्टर लॉक है। सुधार का अनुरोध करें।' },
  MONTH_CLOSED: { en: 'This month is closed. Changes need an approved correction.', mr: 'हा महिना बंद झाला आहे. बदलासाठी मंजूर दुरुस्ती आवश्यक आहे.', hi: 'यह महीना बंद है। बदलाव के लिए स्वीकृत सुधार चाहिए।' },
  MONTH_NOT_OVER: { en: 'A month can be closed only after it ends.', mr: 'महिना संपल्यानंतरच बंद करता येतो.', hi: 'महीना खत्म होने के बाद ही बंद किया जा सकता है।' },
  MONTH_NOT_CLOSED: { en: 'Close the month before signing the muster.', mr: 'हजेरी पत्रकावर सही करण्यापूर्वी महिना बंद करा.', hi: 'हस्ताक्षर से पहले महीना बंद करें।' },
  NOT_WORKING_DAY: { en: 'This is not a working day.', mr: 'हा कामकाजाचा दिवस नाही.', hi: 'यह कार्य दिवस नहीं है।' },
  DATE_OUTSIDE_TERMS: { en: 'The date is outside the academic terms.', mr: 'ही तारीख सत्राबाहेर आहे.', hi: 'यह तारीख सत्र के बाहर है।' },
  POLICY_MISSING: { en: 'No attendance policy is configured. Ask the admin to set one in Settings.', mr: 'हजेरी धोरण ठरवलेले नाही.', hi: 'हाज़िरी नीति सेट नहीं है।' },
  REASON_REQUIRED: { en: 'Please give a reason.', mr: 'कृपया कारण द्या.', hi: 'कृपया कारण दें।' },
  CORRECTION_ALREADY_DECIDED: { en: 'This request has already been decided.', mr: 'या विनंतीवर आधीच निर्णय झाला आहे.', hi: 'इस अनुरोध पर पहले ही निर्णय हो चुका है।' },
  LEAVE_OVERLAP: { en: 'There is already a leave request for these dates.', mr: 'या तारखांसाठी आधीच रजेचा अर्ज आहे.', hi: 'इन तारीखों के लिए पहले से छुट्टी का अनुरोध है।' },
  LEAVE_TOO_OLD: { en: 'Leave cannot be applied this far back.', mr: 'इतक्या मागील तारखेसाठी रजा मागता येत नाही.', hi: 'इतनी पुरानी तारीख के लिए छुट्टी नहीं ली जा सकती।' },
  LEAVE_DOCUMENT_REQUIRED: { en: 'A medical certificate is required for this leave.', mr: 'या रजेसाठी वैद्यकीय प्रमाणपत्र आवश्यक आहे.', hi: 'इस छुट्टी के लिए मेडिकल प्रमाणपत्र आवश्यक है।' },
  LEAVE_TYPE_INVALID: { en: 'Choose a valid leave type.', mr: 'योग्य रजा प्रकार निवडा.', hi: 'सही छुट्टी प्रकार चुनें।' },
  LEAVE_ALREADY_DECIDED: { en: 'This leave request has already been decided.', mr: 'या रजा अर्जावर आधीच निर्णय झाला आहे.', hi: 'इस अनुरोध पर पहले ही निर्णय हो चुका है।' },
  LEAVE_NOT_CANCELLABLE: { en: 'This leave request can no longer be cancelled.', mr: 'हा रजा अर्ज आता रद्द करता येत नाही.', hi: 'यह अनुरोध अब रद्द नहीं हो सकता।' },
  STUDENT_NOT_ENROLLED: { en: 'The student has no current enrollment.', mr: 'विद्यार्थ्याचा सध्या प्रवेश नाही.', hi: 'छात्र का वर्तमान नामांकन नहीं है।' },
  SESSION_HAS_ATTENDANCE: { en: 'Attendance is already recorded for this session.', mr: 'या तासाची हजेरी आधीच नोंदवली आहे.', hi: 'इस सत्र की हाज़िरी पहले ही दर्ज है।' },
  GR_NO_IMMUTABLE: { en: 'A GR number can never be changed.', mr: 'GR क्रमांक बदलता येत नाही.', hi: 'GR नंबर बदला नहीं जा सकता।' },
  STUDENT_NO_DELETE: { en: 'Student records cannot be deleted. Mark the student as left instead.', mr: 'विद्यार्थ्याची नोंद हटवता येत नाही.', hi: 'छात्र रिकॉर्ड हटाया नहीं जा सकता।' },
  EDITION_IMMUTABLE: { en: 'The database edition marker cannot be changed.', mr: 'डेटाबेस आवृत्ती बदलता येत नाही.', hi: 'डेटाबेस संस्करण बदला नहीं जा सकता।' },
  NOT_FOUND: { en: 'Not found.', mr: 'सापडले नाही.', hi: 'नहीं मिला।' },
  INVALID_INPUT: { en: 'Some of the details are not valid.', mr: 'काही माहिती अवैध आहे.', hi: 'कुछ जानकारी मान्य नहीं है।' },
};

const FALLBACK: Messages = {
  en: 'Something went wrong. Please try again.',
  mr: 'काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.',
  hi: 'कुछ गलत हुआ। कृपया फिर से प्रयास करें।',
};

/** Extract a known code from a Postgres / PostgREST error message. */
export function errorCode(message: string | null | undefined): string | null {
  if (!message) return null;
  const direct = message.trim();
  if (ERROR_MESSAGES[direct]) return direct;
  const match = direct.match(/\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/);
  return match && ERROR_MESSAGES[match[1]] ? match[1] : null;
}

export function errorMessage(message: string | null | undefined, lang: Lang = 'en'): string {
  const code = errorCode(message);
  return (code ? ERROR_MESSAGES[code] : FALLBACK)[lang];
}

/** Results returned (not raised) by submit_day_register / submit_attendance. */
export const SUBMIT_RESULT_MESSAGES: Record<string, Messages> = {
  ok: { en: 'Attendance saved.', mr: 'हजेरी जतन केली.', hi: 'हाज़िरी सहेजी गई।' },
  duplicate: { en: 'Already saved.', mr: 'आधीच जतन केली आहे.', hi: 'पहले से सहेजी गई है।' },
  conflict: { en: 'Someone else changed this register. Review the latest version.', mr: 'दुसऱ्या कोणीतरी हे पत्रक बदलले आहे.', hi: 'किसी और ने यह रजिस्टर बदला है।' },
  locked: ERROR_MESSAGES.ATT_LOCKED,
  month_closed: ERROR_MESSAGES.MONTH_CLOSED,
  not_working_day: ERROR_MESSAGES.NOT_WORKING_DAY,
  cancelled: { en: 'This session was cancelled or rescheduled.', mr: 'हा तास रद्द किंवा पुनर्नियोजित झाला.', hi: 'यह सत्र रद्द या पुनर्निर्धारित हुआ।' },
};
