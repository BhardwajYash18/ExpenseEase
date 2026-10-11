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

        # 1. Merchant / Payee / Expense Name Extraction
        merchant_name: Optional[str] = None
        merchant_confidence = 0.0

        stop_meta_words = {
            'age', 'dob', 'date', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'shri', 'smt',
            'male', 'female', 'gender', 'sex', 'phone', 'ph', 'tel', 'mobile',
            'address', 'addr', 'city', 'pin', 'pincode', 'bill', 'receipt', 'tax',
            'dept', 'department', 'room', 'bed', 'reg', 'regn', 'id', 'no', 'num',
            'yr', 'yrs', 'years', 'total', 'amt', 'amount', 'rs', 'inr', 'usd'
        }

        # Step 1a: Check if any of the top lines match known popular brands
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

        # Step 1b: Scan for explicit Name label (e.g. "Name: Vivek Shah", "Patient Name: Vivek Shah")
        # Specification: take words ONLY after the word 'name', exclude 'name' itself, and take at most three words.
        if not merchant_name:
            for idx, line in enumerate(lines[:12]):
                if re.search(r'\bname\b', line, re.I):
                    # Extract text strictly after the word 'name'
                    after_name = re.sub(r'^.*?\bname\b\s*[:=\-]?\s*', '', line, flags=re.I).strip()
                    if not after_name and idx + 1 < len(lines):
                        after_name = lines[idx + 1].strip()

                    if after_name:
                        after_name = re.sub(r'^[=\-:\s\'"]+', '', after_name).strip()
                        tokens = re.findall(r'[A-Za-z]+(?:\'[A-Za-z]+)?', after_name)
                        selected_words = []
                        for token in tokens:
                            token_lower = token.lower()
                            if token_lower == 'name' or token_lower in stop_meta_words:
                                break
                            selected_words.append(token)
                            if len(selected_words) == 3:
                                break
                        if selected_words:
                            merchant_name = " ".join(selected_words)
                            merchant_confidence = 0.95
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

        # Step 1d: Scan the top lines, rigorously filtering out invoice/tax/memo noise
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

        # 2. Date Extraction (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, Mon DD YYYY, DD Mon YYYY, etc.)
        receipt_date: Optional[date] = None
        date_confidence = 0.0

        # Shared month name lookup (handles OCR artifacts like '0ct' for 'Oct')
        mon_map = {
            'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
            'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
            'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9,
            'oct': 10, '0ct': 10, 'october': 10,
            'nov': 11, 'november': 11, 'dec': 12, 'december': 12
        }

        # Pattern 1: YYYY-MM-DD or YYYY/MM/DD (ISO format)
        iso_match = re.search(r'\b(20\d\d)[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b', cleaned_text)
        if iso_match:
            try:
                receipt_date = datetime.strptime(f"{iso_match.group(1)}-{iso_match.group(2)}-{iso_match.group(3)}", "%Y-%m-%d").date()
                date_confidence = 0.95
            except ValueError:
                pass

        # Pattern 2: MM/DD/YYYY (US format — first number is month 01-12)
        if not receipt_date:
            slash_match = re.search(r'\b(0[1-9]|1[0-2])/(0[1-9]|[12]\d|3[01])/(20\d\d)\b', cleaned_text)
            if slash_match:
                try:
                    receipt_date = datetime.strptime(f"{slash_match.group(3)}-{slash_match.group(1)}-{slash_match.group(2)}", "%Y-%m-%d").date()
                    date_confidence = 0.90
                except ValueError:
                    pass

        # Pattern 3: DD/MM/YYYY where day > 12 (unambiguously DD/MM/YYYY, common in India/UK/EU)
        if not receipt_date:
            dd_mm_match = re.search(r'\b(1[3-9]|2\d|3[01])[-/](0[1-9]|1[0-2])[-/](20\d\d)\b', cleaned_text)
            if dd_mm_match:
                try:
                    d_val = int(dd_mm_match.group(1))
                    m_val = int(dd_mm_match.group(2))
                    y_val = int(dd_mm_match.group(3))
                    receipt_date = date(y_val, m_val, d_val)
                    date_confidence = 0.88
                except (ValueError, Exception):
                    pass

        # Pattern 4: Mon DD, YYYY or Month DD, YYYY (e.g. "Oct 12, 2026", "October 12, 2026")
        if not receipt_date:
            mon_dd_match = re.search(
                r'\b([A-Za-z]{3,9})[.,]?\s+(\d{1,2})[,.]?\s+(20\d\d)\b',
                cleaned_text, re.I
            )
            if mon_dd_match:
                m_str = mon_dd_match.group(1).lower()
                d_val = int(mon_dd_match.group(2))
                y_val = int(mon_dd_match.group(3))
                m_num = mon_map.get(m_str)
                if not m_num:
                    m_str_clean = m_str.replace('0', 'o')
                    m_num = mon_map.get(m_str_clean)
                if m_num and 1 <= d_val <= 31:
                    try:
                        receipt_date = date(y_val, m_num, d_val)
                        date_confidence = 0.90
                    except (ValueError, Exception):
                        pass

        # Pattern 5: DD Mon YYYY (e.g. "08 Oct 2026", "8 October 2026")
        if not receipt_date:
            mon_match = re.search(r'\b([0-3]?\d)[\s\-_]+([A-Za-z0-9]{3,9})[\s\-_,]+(20\d\d)\b', cleaned_text)
            if mon_match:
                d_str, m_str, y_str = mon_match.group(1), mon_match.group(2).lower(), mon_match.group(3)
                m_str_clean = m_str.replace('0', 'o')
                m_num = mon_map.get(m_str) or mon_map.get(m_str_clean)
                if m_num:
                    try:
                        receipt_date = date(int(y_str), m_num, int(d_str))
                        date_confidence = 0.92
                    except Exception:
                        pass

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

        # 4. Total Amount Extraction (Primary purpose: accurately find payable claim amount)
        total_amount: Optional[Decimal] = None
        subtotal_amount: Optional[Decimal] = None
        tax_amount: Optional[Decimal] = None
        total_confidence = 0.0

        _currency_pat = r'(?:[\$\u20ac\u00a3\u20b9]|Rs\.?\s*|INR\s*|USD\s*|EUR\s*|GBP\s*)?'
        # Includes common OCR label variations & typos: T0TAL, TOTAI, TOTL
        _total_label = (
            r'\b(?:TOTAL\s*(?:AMOUNT)?|T[0O]TA[LI1]|T[0O]TL|GRAND\s*TOTAL|FINAL\s*(?:TOTAL|AMOUNT)|'
            r'NET\s*(?:AMOUNT|PAYABLE|TOTAL)|AMOUNT\s*(?:DUE|PAYABLE|PAID)|BALANCE\s*DUE|BILL\s*AMOUNT|'
            r'PAID\s*AMOUNT|AMOUNT|AMT)\b'
        )

        # Pass 1: Same-line Label + [Currency] + Amount (decimal or whole number, optional /-)
        same_line_pat = (
            _total_label +
            r'\s*(?:\([^)]*\))?\s*[:=]?\s*' +
            _currency_pat +
            r'\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?:\s*/-)?\b'
        )
        matches = list(re.finditer(same_line_pat, cleaned_text, re.I))
        if matches:
            for m in reversed(matches):
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

        # Pass 2: Next-line split (Label on line 1, Amount on line 2)
        if total_amount is None:
            split_pat = (
                _total_label +
                r'\s*[:=]?\s*\n\s*' +
                _currency_pat +
                r'\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?:\s*/-)?\b'
            )
            m_split = re.search(split_pat, cleaned_text, re.I)
            if m_split:
                raw_val = m_split.group(1).replace(',', '')
                if not re.match(r'^20\d{2}$', raw_val):
                    try:
                        v = Decimal(raw_val)
                        if v > 0:
                            total_amount = v
                            total_confidence = 0.85
                    except Exception:
                        pass

        # Pass 3: Currency-explicit amounts (e.g. "Rs. 450", "₹ 1,250.00", "$17.90")
        if total_amount is None:
            curr_strict_pat = (
                r'(?:[\$\u20ac\u00a3\u20b9]|Rs\.?\s+|INR\s+|USD\s+|EUR\s+|GBP\s+)'
                r'([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?:\s*/-)?\b'
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
                total_confidence = 0.80

        # Pass 4: Fallback heuristic: Largest monetary amount from lines (skipping tax lines)
        if total_amount is None:
            amount_pat = r'\b([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{2})\b'
            all_amounts = []
            for line in cleaned_text.splitlines():
                if re.search(r'\b(tax|vat|gst|cgst|sgst|discount|subtotal)\b', line, re.I):
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
