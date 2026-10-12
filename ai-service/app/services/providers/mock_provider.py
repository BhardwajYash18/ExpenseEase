import re
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Dict
from app.services.providers.base import ReceiptUnderstandingProvider
from app.schemas.receipt_extraction import (
    ReceiptExtractionResponse,
    ReceiptLineItemSchema,
)

CATEGORY_KEYWORDS = {
    "Meals": ["coffee", "cafe", "restaurant", "starbucks", "burger", "pizza", "diner", "lunch", "dinner", "breakfast", "food", "kitchen", "bakery"],
    "Transportation": ["uber", "lyft", "taxi", "cab", "metro", "subway", "transit", "train", "parking", "toll", "gas", "fuel", "chevron", "shell"],
    "Accommodation": ["hotel", "inn", "suites", "motel", "hilton", "marriott", "hyatt", "airbnb", "resort", "lodging"],
    "Travel": ["airline", "airways", "flight", "delta", "united", "american airlines", "lufthansa", "boarding"],
    "Software": ["github", "aws", "amazon web services", "cloud", "slack", "figma", "zoom", "google workspace", "jetbrains", "microsoft", "subscription"],
    "Office Supplies": ["staples", "office depot", "officemax", "paper", "stationery", "printer", "ink", "cartridge"],
}

class MockReceiptProvider(ReceiptUnderstandingProvider):
    """
    Deterministic mock provider for CI, testing, and offline environments.
    Extracts structured data using regex heuristics while respecting all AI safety rules.
    """

    async def extract(
        self,
        ocr_raw_text: str,
        image_base64: Optional[str] = None,
        mime_type: Optional[str] = None
    ) -> ReceiptExtractionResponse:
        cleaned_text = (ocr_raw_text or "").strip()
        review_reasons: List[str] = []

        if not cleaned_text:
            return ReceiptExtractionResponse(
                merchant_name=None,
                receipt_date=None,
                total_amount=None,
                subtotal_amount=None,
                tax_amount=None,
                currency="USD",
                receipt_number=None,
                suggested_category="Other",
                line_items=[],
                confidence_score=0.0,
                is_flagged_for_review=True,
                review_reasons=["Empty or unreadable OCR text"],
                field_confidences={"merchant": 0.0, "date": 0.0, "total_amount": 0.0, "category": 0.0},
                raw_model_response='{"error": "Empty OCR text"}',
                model_provider="mock",
                model_name="mock-deterministic-v1"
            )

        lines = [line.strip() for line in cleaned_text.splitlines() if line.strip()]

        # Boilerplate header terms that must NEVER be extracted as the merchant / expense name
        header_noise_patterns = [
            r'^(?:tax|retail|commercial|cash|proforma|vat|gst)?\s*(?:invoice|bill|memo|receipt|voucher|cashier|slip)\b',
            r'^(?:original|duplicate|triplicate|customer|merchant|client|buyer|seller|transporter)\s*(?:copy|recipient)?\b',
            r'^(?:bill|invoice|receipt)\s*(?:of\s*supply|no\.?|number|id|#)\b',
            r'^(?:gstin|gst|vat|pan|tin|cin|stn|fssai|tan|reg|regn|pos|terminal|mid|tid)\b',
            r'^(?:welcome(?:\s+to)?|thank\s*you(?:\s*for\s*(?:your\s*)?(?:visit|shopping|business))?|visit\s*again)\b',
            r'^(?:date|time|table|order|token|counter|waiter|server|cashier|check|chk)\s*[:#\d]',
            r'^(?:tel|phone|ph|mobile|fax|email|web|website|http|www)\b',
            r'^(?:shop|flat|plot|floor|building|road|street|lane|ave|nagar|block|sector|city|state|pin|pincode|zip)\b',
            r'^\d+$',
            r'^[^\w\s]+$',
        ]

        known_brands = [
            "starbucks", "mcdonald", "burger king", "kfc", "subway", "domino", "pizza hut",
            "chaayos", "chai point", "cafe coffee day", "blue bottle", "costa coffee",
            "uber", "ola", "lyft", "grab", "rapido", "blusmart",
            "shell", "bp", "chevron", "exxon", "hp petrol", "indian oil", "bharat petroleum",
            "walmart", "target", "costco", "d-mart", "reliance", "croma", "ikea", "decathlon",
            "amazon", "flipkart", "swiggy", "zomato", "blinkit", "zepto", "instamart",
            "airtel", "jio", "vodafone", "apple", "google", "microsoft", "aws", "github", "slack", "zoom",
            "indigo", "air india", "vistara", "delta", "united", "american airlines", "emirates",
            "marriott", "hilton", "hyatt", "radisson", "taj", "oberoi", "oyo", "airbnb",
            "staples", "office depot", "officemax"
        ]

        # 1. Name / Merchant / Payee Extraction
        merchant_name: Optional[str] = None
        merchant_confidence = 0.0

        stop_meta_words = {
            'age', 'dob', 'date', 'dt', 'dated', 'time', 'am', 'pm', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'shri', 'smt',
            'prof', 'master', 'miss', 'male', 'female', 'gender', 'sex', 'phone', 'ph', 'tel', 'mob', 'mobile', 'cell',
            'contact', 'email', 'mail', 'address', 'addr', 'city', 'state', 'pin', 'pincode', 'zip', 'street', 'road',
            'bill', 'receipt', 'tax', 'gst', 'gstin', 'vat', 'cgst', 'sgst', 'igst', 'inv', 'invoice', 'memo',
            'dept', 'department', 'room', 'bed', 'ward', 'uhid', 'ipd', 'opd', 'consultant', 'reg', 'regn', 'id', 'no',
            'num', 'number', 'aadhaar', 'pan', 'uid', 'card', 'ref', 'reference', 'yr', 'yrs', 'years', 'y',
            'total', 'amt', 'amount', 'mrp', 'rs', 'inr', 'usd', 'eur', 'gbp', 'balance', 'bal', 'due', 'paid', 'net',
            'subtotal', 'cash', 'card', 'upi', 'paytm', 'gpay', 'phonepe', 'name', 'patient', 'customer', 'client', 'employee'
        }

        name_label_regex = re.compile(
            r'\b(?:(?:patient|customer|cust|client|employee|emp|staff|guest|pax|passenger|buyer|member|user|holder|cardholder|billed\s*to|bill\s*to|pt)\s*(?:[\'’]s)?\s*)?name(?:\s+of\s+(?:patient|customer|client|passenger|guest|buyer|employee|person))?\b\s*[:=\-]?\s*(.*)$',
            re.I
        )
        honorifics_regex = re.compile(r'^(?:mr|mrs|ms|miss|dr|doctor|shri|smt|master|prof)\.?\s+', re.I)

        # Step 1a: Explicit Name label scan (e.g. "Patient Name: Vivek Kumar Shah Age: 28", "Customer Name: Rahul Sharma")
        # Rule: Name is written only after "name" or something similar, strictly 2 to 3 words long, without extraneous data near it.
        for idx, line in enumerate(lines):
            match = name_label_regex.search(line)
            if match:
                raw_tail = match.group(1).strip()
                # If name is on next line
                if not raw_tail and idx + 1 < len(lines):
                    next_l = lines[idx + 1].strip()
                    if not name_label_regex.search(next_l) and not re.search(r'^(?:date|age|sex|gender|phone|ph|address|total|mrp|tax|inv)\b', next_l, re.I):
                        raw_tail = next_l

                if raw_tail:
                    # Strip leading punctuation and noise
                    raw_tail = re.sub(r'^[=\-:\s\'"|/]+', '', raw_tail).strip()
                    # Truncate at delimiters that separate fields (comma, pipe, semicolon, brackets, colon)
                    raw_tail = re.split(r'[,|;(\[\\]', raw_tail)[0].strip()
                    # Strip title honorifics
                    raw_tail = honorifics_regex.sub('', raw_tail).strip()

                    tokens = re.findall(r'[A-Za-z]+(?:\'[A-Za-z]+)?', raw_tail)
                    name_words = []
                    for token in tokens:
                        tok_lower = token.lower()
                        if tok_lower in stop_meta_words:
                            break
                        if len(token) >= 2 or (len(token) == 1 and token.isupper()):
                            name_words.append(token)
                        if len(name_words) == 3:
                            break

                    # Enforce length: name can only be two to three words long
                    if len(name_words) in [2, 3]:
                        merchant_name = " ".join(name_words).title()
                        merchant_confidence = 0.98
                        break
                    elif len(name_words) == 1 and not merchant_name:
                        merchant_name = name_words[0].title()
                        merchant_confidence = 0.85

        # Step 1b: Check known popular retail brands (if no explicit person name was found)
        if not merchant_name:
            for line in lines[:10]:
                line_lower = line.lower()
                for brand in known_brands:
                    if brand in line_lower:
                        clean = re.sub(r'^(?:welcome\s+to\s+|thank\s+you\s+for\s+visiting\s+)', '', line, flags=re.I).strip()
                        if len(clean) >= 3 and not any(re.search(pat, clean, re.I) for pat in header_noise_patterns):
                            merchant_name = clean[:255]
                        else:
                            merchant_name = brand.title()
                        merchant_confidence = 0.95
                        break
                if merchant_name:
                    break

        # Step 1c: Check for explicit Merchant / Store / Vendor / Seller label
        if not merchant_name:
            for idx, line in enumerate(lines):
                if re.match(r'^(?:Merchant|Store|Vendor|Billed\s*By|Seller)\b', line, re.I):
                    lbl_m = re.match(r'^(?:Merchant|Store|Vendor|Billed\s*By|Seller)\s*[:=]?\s*(.+)$', line, re.I)
                    if lbl_m and not re.search(r'\b(payment|method|date|gstin|tax|invoice|bill)\b', lbl_m.group(1), re.I):
                        cand = lbl_m.group(1).strip()
                        if len(cand) >= 2:
                            merchant_name = cand[:255]
                            merchant_confidence = 0.95
                            break
                    if idx + 1 < len(lines):
                        cand = lines[idx + 1].strip()
                        if len(cand) >= 2 and not any(re.search(pat, cand, re.I) for pat in header_noise_patterns):
                            merchant_name = cand[:255]
                            merchant_confidence = 0.90
                            break

        # Step 1d: Scan the top lines, filtering out invoice/tax/memo noise
        if not merchant_name:
            for line in lines[:8]:
                if any(re.search(pat, line, re.I) for pat in header_noise_patterns):
                    continue
                if re.search(r'\b\d{5,6}\b', line):  # pincode / zip code
                    continue
                if re.search(r'^\d', line):  # starts with digit
                    continue
                if len(re.findall(r'[a-zA-Z]', line)) < 3:
                    continue
                cand = re.sub(r'^(?:welcome\s+to\s+)', '', line, flags=re.I).strip()
                if len(cand) >= 3 and not any(re.search(pat, cand, re.I) for pat in header_noise_patterns):
                    merchant_name = cand[:255]
                    merchant_confidence = 0.85
                    break

        # Step 1e: Fallback: best non-empty line
        if not merchant_name and lines:
            for line in lines[:5]:
                if not re.search(r'\b(tax|invoice|bill|receipt|gstin|memo)\b', line, re.I) and len(line) >= 3:
                    merchant_name = line[:255]
                    merchant_confidence = 0.60
                    break
            if not merchant_name:
                merchant_name = lines[0][:255]
                merchant_confidence = 0.40

        # 2. Date Extraction (Comprehensive support for all date formats)
        receipt_date: Optional[date] = None
        date_confidence = 0.0

        mon_map = {
            'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
            'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
            'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9,
            'oct': 10, '0ct': 10, 'october': 10,
            'nov': 11, 'november': 11, 'dec': 12, 'december': 12
        }

        def _safe_build_date(y: int, m: int, d: int) -> Optional[date]:
            if y < 100:
                y += 2000 if y <= 50 else 1900
            if not (2000 <= y <= 2035 and 1 <= m <= 12 and 1 <= d <= 31):
                return None
            try:
                return date(y, m, d)
            except Exception:
                return None

        is_indian_or_euro = bool(re.search(r'\b(INR|GST|GSTIN|CGST|SGST|IGST|Rs\.?|₹|India|EUR|GBP|€|£|UPI|Paytm)\b', cleaned_text, re.I))

        def _parse_candidate_date(s: str) -> Optional[date]:
            # Pattern A: Day Month Year with textual month (e.g. 12 Oct 2026, 12th October 2026, 12-Oct-26, 12.OCT.2026, 12/Oct/2026)
            ma = re.search(r'\b([0-3]?\d)(?:st|nd|rd|th)?[\s\-_./]+([A-Za-z0]{3,9})[\s\-_./]+(20\d\d|\d{2})\b', s)
            if ma:
                d_val = int(ma.group(1))
                m_clean = ma.group(2).lower().replace('0', 'o')
                y_val = int(ma.group(3))
                m_val = mon_map.get(m_clean)
                if m_val:
                    res = _safe_build_date(y_val, m_val, d_val)
                    if res: return res

            # Pattern B: Month Day Year with textual month (e.g. Oct 12, 2026, October 12th 2026, Oct 12 26)
            mb = re.search(r'\b([A-Za-z0]{3,9})\.?\s+([0-3]?\d)(?:st|nd|rd|th)?[,\s\-_./]+(20\d\d|\d{2})\b', s)
            if mb:
                m_clean = mb.group(1).lower().replace('0', 'o')
                d_val = int(mb.group(2))
                y_val = int(mb.group(3))
                m_val = mon_map.get(m_clean)
                if m_val:
                    res = _safe_build_date(y_val, m_val, d_val)
                    if res: return res

            # Pattern C: ISO numeric: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
            mc = re.search(r'\b(20\d\d)[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b', s)
            if mc:
                res = _safe_build_date(int(mc.group(1)), int(mc.group(2)), int(mc.group(3)))
                if res: return res

            # Pattern D: Unambiguous DD/MM/YYYY or DD/MM/YY (where day > 12)
            md = re.search(r'\b(1[3-9]|2\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d\d|\d{2})\b', s)
            if md:
                res = _safe_build_date(int(md.group(3)), int(md.group(2)), int(md.group(1)))
                if res: return res

            # Pattern E: Unambiguous MM/DD/YYYY or MM/DD/YY (where month <= 12 and day > 12)
            me = re.search(r'\b(0?[1-9]|1[0-2])[-/.](1[3-9]|2\d|3[01])[-/.](20\d\d|\d{2})\b', s)
            if me:
                res = _safe_build_date(int(me.group(3)), int(me.group(1)), int(me.group(2)))
                if res: return res

            # Pattern F: Ambiguous numeric dates: both numbers <= 12
            mf = re.search(r'\b(0?[1-9]|1[0-2])([-/.])(0?[1-9]|1[0-2])\2(20\d\d|\d{2})\b', s)
            if mf:
                p1, sep, p2, yr = int(mf.group(1)), mf.group(2), int(mf.group(3)), int(mf.group(4))
                # Dot (.) and dash (-) are standard DD.MM.YYYY / DD-MM-YYYY globally
                if sep in ['.', '-'] or is_indian_or_euro:
                    res = _safe_build_date(yr, p2, p1)
                else:
                    res = _safe_build_date(yr, p1, p2)
                if res: return res

            return None

        # Priority 1: Check lines with explicit date labels (e.g. "Date: 12/10/2026", "Invoice Date: 12-10-26", "Dt: 12.10.2026")
        date_label_pat = re.compile(
            r'\b(?:invoice\s*date|bill\s*date|txn\s*date|transaction\s*date|receipt\s*date|sale\s*date|dated|date|dt)\b\s*[:=\-]?\s*(.*)$',
            re.I
        )
        for line in lines:
            dlm = date_label_pat.search(line)
            if dlm:
                parsed_d = _parse_candidate_date(dlm.group(1).strip())
                if parsed_d:
                    receipt_date = parsed_d
                    date_confidence = 0.98
                    break

        # Priority 2: Scan full text if not matched by label
        if not receipt_date:
            parsed_d = _parse_candidate_date(cleaned_text)
            if parsed_d:
                receipt_date = parsed_d
                date_confidence = 0.92

        # 3. Currency Detection
        currency = "USD"
        if "€" in cleaned_text or re.search(r'\bEUR\b', cleaned_text, re.I):
            currency = "EUR"
        elif "£" in cleaned_text or re.search(r'\bGBP\b', cleaned_text, re.I):
            currency = "GBP"
        elif "₹" in cleaned_text or re.search(r'\b(INR|GSTIN|India|Google Pay|UPI|Paytm)\b', cleaned_text, re.I):
            currency = "INR"
        elif "$" in cleaned_text or re.search(r'\bUSD\b', cleaned_text, re.I):
            currency = "USD"

        # 4. Total Amount / MRP Extraction (Ensures Total Amount & MRP are accurately captured)
        total_amount: Optional[Decimal] = None
        subtotal_amount: Optional[Decimal] = None
        tax_amount: Optional[Decimal] = None
        total_confidence = 0.0

        _currency_pat = r'(?:[\$\u20ac\u00a3\u20b9]|Rs\.?\s*|INR\s*|USD\s*|EUR\s*|GBP\s*)?'
        _amount_num_pat = r'([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?:\s*/-)?\b'

        _mrp_label = r'(?:M\s*\.?\s*R\s*\.?\s*P\s*\.?|MAXIMUM\s*RETAIL\s*PRICE|\bMRP\b)'
        _total_label = (
            r'\b(?:TOTAL\s*(?:AMOUNT)?|T[0O]TA[LI1]|T[0O]TL|GRAND\s*TOTAL|FINAL\s*(?:TOTAL|AMOUNT)|'
            r'NET\s*(?:AMOUNT|PAYABLE|TOTAL|AMT|VALUE)|BILL\s*(?:AMOUNT|AMT|TOTAL)|'
            r'INVOICE\s*(?:TOTAL|AMOUNT|AMT)|AMOUNT\s*(?:DUE|PAYABLE|PAID)|'
            r'BALANCE\s*DUE|PAID\s*AMOUNT|TOTAL\s*PAYABLE|PAYABLE\s*AMOUNT|'
            r'TOTAL\s*AMT|TOT\s*AMT|TTL\s*AMT|AMOUNT|AMT)\b'
        )

        # Pass 1: Explicit MRP Label + Amount on the same line (e.g. "MRP: Rs. 450.00", "M.R.P. : 500/-", "MRP (Incl. taxes) : 250.00")
        mrp_same_line_pat = (
            _mrp_label +
            r'(?:\s*\([^)]*\))?\s*[:=]?\s*' +
            _currency_pat +
            r'\s*' + _amount_num_pat
        )
        mrp_matches = list(re.finditer(mrp_same_line_pat, cleaned_text, re.I))
        if mrp_matches:
            for m in reversed(mrp_matches):
                raw_val = m.group(1).replace(',', '')
                if not re.match(r'^20\d{2}$', raw_val):
                    try:
                        v = Decimal(raw_val)
                        if v > 0:
                            total_amount = v
                            total_confidence = 0.98
                            break
                    except Exception:
                        pass

        # Pass 2: Explicit Total / Grand Total / Net Amount / Bill Amount on the same line
        if total_amount is None:
            total_same_line_pat = (
                _total_label +
                r'\s*(?:\([^)]*\))?\s*[:=]?\s*' +
                _currency_pat +
                r'\s*' + _amount_num_pat
            )
            total_matches = list(re.finditer(total_same_line_pat, cleaned_text, re.I))
            if total_matches:
                for m in reversed(total_matches):
                    raw_val = m.group(1).replace(',', '')
                    if not re.match(r'^20\d{2}$', raw_val):
                        try:
                            v = Decimal(raw_val)
                            if v > 0:
                                total_amount = v
                                total_confidence = 0.95
                                break
                        except Exception:
                            pass

        # Pass 3: Next-line split for MRP or Total Amount (Label on line 1, Amount on line 2)
        if total_amount is None:
            comb_split_pat = (
                f"(?:{_mrp_label}|{_total_label})" +
                r'\s*[:=]?\s*\n\s*' +
                _currency_pat +
                r'\s*' + _amount_num_pat
            )
            m_split = re.search(comb_split_pat, cleaned_text, re.I)
            if m_split:
                raw_val = m_split.group(1).replace(',', '')
                if not re.match(r'^20\d{2}$', raw_val):
                    try:
                        v = Decimal(raw_val)
                        if v > 0:
                            total_amount = v
                            total_confidence = 0.90
                    except Exception:
                        pass

        # Pass 4: Currency-explicit amounts (e.g. "Rs. 450", "₹ 1,250.00", "$17.90", "450/-")
        if total_amount is None:
            curr_strict_pat = (
                r'(?:[\$\u20ac\u00a3\u20b9]|Rs\.?\s+|INR\s+|USD\s+|EUR\s+|GBP\s+)' +
                _amount_num_pat
            )
            curr_matches = list(re.finditer(curr_strict_pat, cleaned_text, re.I))
            candidates = []
            for cm in curr_matches:
                raw_val = cm.group(1).replace(',', '')
                if not re.match(r'^20\d{2}$', raw_val):
                    try:
                        candidates.append(Decimal(raw_val))
                    except Exception:
                        pass
            if candidates:
                total_amount = max(candidates)
                total_confidence = 0.85

        # Pass 5: Fallback heuristic: Largest monetary amount from lines (skipping taxes and phone numbers)
        if total_amount is None:
            amount_pat = r'\b([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{2})\b'
            all_amounts = []
            for line in cleaned_text.splitlines():
                if re.search(r'\b(tax|vat|gst|cgst|sgst|discount|subtotal|phone|mob|tel)\b', line, re.I):
                    continue
                for am in re.finditer(amount_pat, line):
                    raw_val = am.group(1).replace(',', '')
                    try:
                        all_amounts.append(Decimal(raw_val))
                    except Exception:
                        pass
            if all_amounts:
                total_amount = max(all_amounts)
                total_confidence = 0.70
                review_reasons.append("Total amount inferred from receipt amounts; verify value")

        # Subtotal (with decimal or whole number)
        subtotal_match = re.search(
            r'\b(?:SUBTOTAL|SUB\s*TOTAL|NET\s*AMOUNT)\s*(?:\([^)]*\))?\s*[:=]?\s*' + _currency_pat + r'\s*([0-9]+[.,]?[0-9]*)\b',
            cleaned_text, re.I
        )
        if subtotal_match:
            val_str = subtotal_match.group(1).replace(',', '.')
            try:
                subtotal_amount = Decimal(val_str)
            except Exception:
                pass

        # Tax (with decimal or whole number)
        tax_match = re.search(
            r'\b(?:TAX|VAT|GST|CGST|SGST|IGST|HST)\s*(?:\([^)]*\))?\s*[:=]?\s*' + _currency_pat + r'\s*([0-9]+[.,]?[0-9]*)\b',
            cleaned_text, re.I
        )
        if tax_match:
            val_str = tax_match.group(1).replace(',', '.')
            try:
                tax_amount = Decimal(val_str)
            except Exception:
                pass

        # 5. Receipt Number
        receipt_number: Optional[str] = None
        # Try explicit number prefix (# / No / Num) first
        rcpt_num_match = re.search(r'\b(?:RECEIPT|INVOICE|ORDER|TRANS|TICKET)\s*(?:#|NO\.?|NUM)\s*[:=]?\s*([A-Za-z0-9\-_]{4,30})\b', cleaned_text, re.I)
        if rcpt_num_match:
            receipt_number = rcpt_num_match.group(1)
        else:
            rcpt_num_match = re.search(r'\b(?:RECEIPT|INVOICE|ORDER|TRANS|TICKET)\s*[:=]?\s*([A-Za-z0-9\-_]{4,30})\b', cleaned_text, re.I)
            if rcpt_num_match:
                candidate_num = rcpt_num_match.group(1)
                if not re.search(r'^(expenseease|receipt)$', candidate_num, re.I):
                    receipt_number = candidate_num



        # 6. Category Suggestion
        suggested_category = "Other"
        category_confidence = 0.40
        text_lower = cleaned_text.lower()
        for cat, keywords in CATEGORY_KEYWORDS.items():
            if any(k in text_lower for k in keywords):
                suggested_category = cat
                category_confidence = 0.85
                break

        # 7. Line Items Extraction
        line_items: List[ReceiptLineItemSchema] = []
        item_counter = 1
        for line in lines:
            # Check for item lines matching "Item Description ... 12.34"
            item_match = re.search(r'^([A-Za-z0-9\s\-_&]{2,40})\s+[\$€£₹]?\s*([0-9]+[.,][0-9]{2})$', line)
            if item_match:
                desc = item_match.group(1).strip()
                # Exclude summary rows like Total, Subtotal, Tax, Change, Cash, Card
                if not re.search(r'\b(total|subtotal|tax|vat|gst|change|cash|card|balance|visa|mastercard|amex)\b', desc, re.I):
                    price_val = Decimal(item_match.group(2).replace(',', '.'))
                    line_items.append(ReceiptLineItemSchema(
                        line_number=item_counter,
                        description=desc,
                        quantity=Decimal("1.0"),
                        unit_price=price_val,
                        total_price=price_val
                    ))
                    item_counter += 1

        # 8. Overall Confidence & Flags
        if receipt_date is None:
            review_reasons.append("Receipt date could not be determined")
        if total_amount is None:
            review_reasons.append("Total amount could not be determined")
        if merchant_name is None:
            review_reasons.append("Merchant name could not be determined")

        field_confidences: Dict[str, float] = {
            "merchant": merchant_confidence,
            "date": date_confidence,
            "total_amount": total_confidence,
            "category": category_confidence,
        }

        # Average confidence of core fields
        core_confs = [merchant_confidence, date_confidence, total_confidence, category_confidence]
        overall_confidence = round(sum(core_confs) / len(core_confs), 2)

        is_flagged = len(review_reasons) > 0 or overall_confidence < 0.70

        return ReceiptExtractionResponse(
            merchant_name=merchant_name,
            receipt_date=receipt_date,
            total_amount=total_amount,
            subtotal_amount=subtotal_amount,
            tax_amount=tax_amount,
            currency=currency,
            receipt_number=receipt_number,
            suggested_category=suggested_category,
            line_items=line_items,
            confidence_score=overall_confidence,
            is_flagged_for_review=is_flagged,
            review_reasons=review_reasons,
            field_confidences=field_confidences,
            raw_model_response=None,
            model_provider="mock",
            model_name="mock-deterministic-v1"
        )
