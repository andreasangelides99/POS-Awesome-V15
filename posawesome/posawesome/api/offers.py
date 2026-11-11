# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import json
import frappe
from frappe.utils import add_days, cint, nowdate
from posawesome.posawesome.doctype.pos_coupon.pos_coupon import check_coupon_code
from posawesome.posawesome.doctype.delivery_charges.delivery_charges import (
    get_applicable_delivery_charges as _get_applicable_delivery_charges,
)


@frappe.whitelist()
def get_pos_coupon(coupon, customer, company):
    res = check_coupon_code(coupon, customer, company)
    return res


@frappe.whitelist()
def get_active_gift_coupons(customer, company):
    coupons = []
    coupons_data = frappe.get_all(
        "POS Coupon",
        filters={
            "company": company,
            "coupon_type": "Gift Card",
            "customer": customer,
            "used": 0,
        },
        fields=["coupon_code"],
    )
    if len(coupons_data):
        coupons = [i.coupon_code for i in coupons_data]
    return coupons


@frappe.whitelist()
def get_offers(profile, ahead=0):
    """Offers for this till today. Cake Zone (11 Nov 2026): with `ahead`, also those starting in
    the next week, so a till that loses the internet still has tomorrow's specials; the till
    itself keeps only the ones whose days include today (useOffers.js). Without `ahead` - an
    older till page - only today's, as before, so nothing applies early."""
    pos_profile = frappe.get_doc("POS Profile", profile)
    company = pos_profile.company
    warehouse = pos_profile.warehouse
    date = nowdate()
    starts_by = add_days(date, 7) if cint(ahead) else date

    values = {
        "company": company,
        "pos_profile": profile,
        "warehouse": warehouse,
        "valid_from": starts_by,
        "valid_upto": date,
    }
    data = frappe.db.sql(
        """
        SELECT *
        FROM `tabPOS Offer`
        WHERE 
        disable = 0 AND
        company = %(company)s AND
        (pos_profile is NULL OR pos_profile  = '' OR  pos_profile = %(pos_profile)s) AND
        (warehouse is NULL OR warehouse  = '' OR  warehouse = %(warehouse)s) AND
        (valid_from is NULL OR valid_from  = '' OR  valid_from <= %(valid_from)s) AND
        (valid_upto is NULL OR valid_upto >= %(valid_upto)s)
    """,
        values=values,
        as_dict=1,
    )
    return data


@frappe.whitelist()
def get_applicable_delivery_charges(
    company, pos_profile, customer, shipping_address_name=None
):
    return _get_applicable_delivery_charges(
        company, pos_profile, customer, shipping_address_name
    )
