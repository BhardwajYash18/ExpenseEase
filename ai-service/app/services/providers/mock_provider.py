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

        # 1. Merchant Extraction
        merchant_name: Optional[str] = None
        merchant_confidence = 0.0

        # Check for explicit Merchant: label or section
        for idx, line in enumerate(lines):
            if re.match(r'^(?:Merchant|Store|Vendor)\b', line, re.I):
                lbl_m = re.match(r'^(?:Merchant|Store|Vendor)\s*[:=]?\s*(.+)$', line, re.I)
                if lbl_m and not re.search(r'\b(payment|method|date|gstin)\b', lbl_m.group(1), re.I):
                    merchant_name = lbl_m.group(1).strip()[:255]
                    merchant_confidence = 0.95
                    break
                # Search subsequent lines for merchant name
                for offset in range(1, 4):
                    if idx + offset < len(lines):
                        cand = lines[idx + offset].strip()
                        if not re.search(r'\b(payment|method|date|total|rate|qty|subtotal|upi|card|cash|gstin|receipt|tax|invoice|bill|expenses|simple)\b', cand, re.I) and len(cand) > 2:
                            merchant_name = cand[:255]
                            merchant_confidence = 0.95
                            break
                if merchant_name:
                    break

        if not merchant_name:
            for line in lines[:6]:
                # Filter out platform name, dates, amounts, receipt words
                if not re.search(r'\b(receipt|invoice|bill|tax|date|total|welcome|thank you|expenseease|expenses|simple)\b', line, re.I) and not re.search(r'^\d', line):
                    merchant_name = line[:255]
                    merchant_confidence = 0.85
                    break

        if not merchant_name and lines:
            merchant_name = lines[0][:255]
            merchant_confidence = 0.50


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
                # Try matching month name (prefix match for abbreviated forms)
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

        # 4. Total, Subtotal, and Tax Extraction
        total_amount: Optional[Decimal] = None
        subtotal_amount: Optional[Decimal] = None
        tax_amount: Optional[Decimal] = None
        total_confidence = 0.0

        # Currency pattern (symbols and common abbreviations)
        _currency_pat = r'(?:[\$\u20ac\u00a3\u20b9]|Rs\.?\s*|INR\s*|USD\s*|EUR\s*|GBP\s*)?'
        _total_label = r'\b(?:TOTAL\s*(?:AMOUNT)?|AMOUNT\s*DUE|BALANCE\s*DUE|GRAND\s*TOTAL)'

        # Pass 1: Total with decimal amount on same line
        total_match = re.search(
            _total_label + r'\s*(?:\([^)]*\))?\s*[:=]?\s*' + _currency_pat + r'\s*([0-9]+[.,][0-9]{1,2})\b',
            cleaned_text, re.I
        )
        if total_match:
            val_str = total_match.group(1).replace(',', '.')
            try:
                total_amount = Decimal(val_str)
                total_confidence = 0.95
            except Exception:
                pass

        # Pass 2: Total with whole number (no decimals, e.g. "TOTAL: Rs 450")
        if total_amount is None:
            total_whole_match = re.search(
                _total_label + r'\s*(?:\([^)]*\))?\s*[:=]?\s*' + _currency_pat + r'\s*([0-9]{2,})\b',
                cleaned_text, re.I
            )
            if total_whole_match:
                val = total_whole_match.group(1)
                # Avoid matching year values like 2026
                if not re.match(r'^20\d{2}$', val):
                    try:
                        total_amount = Decimal(val)
                        total_confidence = 0.80
                        review_reasons.append("Total amount has no decimal places; verify correctness")
                    except Exception:
                        pass

        # Pass 3: Total label on one line, amount on next (OCR split)
        if total_amount is None:
            total_split_match = re.search(
                _total_label + r'\s*(?:AMOUNT)?\s*[:=]?\s*\n\s*' + _currency_pat + r'\s*([0-9]+[.,]?[0-9]*)\b',
                cleaned_text, re.I
            )
            if total_split_match:
                val_str = total_split_match.group(1).replace(',', '.')
                if val_str and not re.match(r'^20\d{2}$', val_str):
                    try:
                        total_amount = Decimal(val_str)
                        total_confidence = 0.75
                        review_reasons.append("Total found on line after label; verify amount")
                    except Exception:
                        pass

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

        # Fallback: search for largest currency-adjacent amount if no explicit total found
        if total_amount is None:
            # Match amounts with optional currency symbols or standalone decimal amounts
            all_amounts = re.findall(r'(?:[\$\u20ac\u00a3\u20b9]|Rs\.?\s*)\s*([0-9]+[.,]?[0-9]*)\b', cleaned_text)
            # Also match standalone decimal numbers (e.g., 45.50)
            all_amounts += re.findall(r'\b([0-9]+\.[0-9]{1,2})\b', cleaned_text)
            decimals = []
            for a in all_amounts:
                a_clean = a.replace(',', '.')
                try:
                    d = Decimal(a_clean)
                    # Filter out years and very small numbers
                    if d > 0 and not re.match(r'^20\d{2}$', a_clean.split('.')[0]):
                        decimals.append(d)
                except Exception:
                    pass
            if decimals:
                total_amount = max(decimals)
                total_confidence = 0.60
                review_reasons.append("Total amount inferred from largest parsed number; verify before submitting")

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
