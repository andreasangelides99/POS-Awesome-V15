# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import json
import frappe
from frappe.utils import nowdate
from frappe import _
from .utilities import get_version


@frappe.whitelist()
def get_opening_dialog_data():
    data = {}

    # Get only POS Profiles where current user is defined in POS Profile User table
    pos_profiles_data = frappe.db.sql(
        """
        SELECT DISTINCT p.name, p.company, p.currency 
        FROM `tabPOS Profile` p
        INNER JOIN `tabPOS Profile User` u ON u.parent = p.name
        WHERE p.disabled = 0 AND u.user = %s
        ORDER BY p.name
    """,
        frappe.session.user,
        as_dict=1,
    )

    data["pos_profiles_data"] = pos_profiles_data

    # Derive companies from accessible POS Profiles
    company_names = []
    for profile in pos_profiles_data:
        if profile.company and profile.company not in company_names:
            company_names.append(profile.company)
    data["companies"] = [{"name": c} for c in company_names]

    pos_profiles_list = []
    for i in data["pos_profiles_data"]:
        pos_profiles_list.append(i.name)

    payment_method_table = (
        "POS Payment Method" if get_version() == 13 else "Sales Invoice Payment"
    )
    methods = frappe.get_list(
        payment_method_table,
        filters={"parent": ["in", pos_profiles_list]},
        fields=["*"],
        limit_page_length=0,
        order_by="parent",
        ignore_permissions=True,
    )

    # ONLY A CASH TENDER HAS AN OPENING FLOAT. This list is consumed by exactly one
    # place - OpeningDialog.vue, to build the balance_details rows - so upstream was
    # asking a cashier for an opening amount against CREDIT CARD, which has no float:
    # that money is with the bank, not in the drawer. A figure typed there becomes the
    # card's expected_amount at close and reads as a difference nobody can explain.
    #
    # Card is NOT lost from the close: pos_closing_shift seeds payment_reconciliation
    # from these balance_details and then APPENDS any mode that actually took money,
    # with an opening of 0 - which is the correct row for a card.
    cash_modes = {
        m.name for m in frappe.get_all("Mode of Payment", fields=["name", "type"])
        if m.type == "Cash"
    }
    cash_only = [m for m in methods if m.get("mode_of_payment") in cash_modes]
    # A profile with no cash tender at all would otherwise be unable to open a shift,
    # because the dialog refuses to submit an empty balance table.
    data["payments_method"] = cash_only or methods
    # set currency from pos profile
    for mode in data["payments_method"]:
        mode["currency"] = frappe.get_cached_value(
            "POS Profile", mode["parent"], "currency"
        )
        # Cake Zone: the float is a property of the TILL, not a number somebody
        # types each morning. Sent here so the dialog can show it locked rather
        # than accept a figure the server then silently overrides - a number that
        # quietly changes is worse than no number at all.
        mode["cash_float"] = frappe.get_cached_value(
            "POS Profile", mode["parent"], "custom_cash_float"
        )

    return data


@frappe.whitelist()
def create_opening_voucher(pos_profile, company, balance_details):
    balance_details = json.loads(balance_details)

    new_pos_opening = frappe.get_doc(
        {
            "doctype": "POS Opening Shift",
            "period_start_date": frappe.utils.get_datetime(),
            "posting_date": frappe.utils.getdate(),
            "user": frappe.session.user,
            "pos_profile": pos_profile,
            "company": company,
            "docstatus": 1,
        }
    )
    new_pos_opening.set("balance_details", balance_details)
    new_pos_opening.insert(ignore_permissions=True)

    data = {}
    data["pos_opening_shift"] = new_pos_opening.as_dict()
    update_opening_shift_data(data, new_pos_opening.pos_profile)
    return data


@frappe.whitelist()
def check_opening_shift(user):
    open_vouchers = frappe.db.get_all(
        "POS Opening Shift",
        filters={
            "user": user,
            "pos_closing_shift": ["in", ["", None]],
            "docstatus": 1,
            "status": "Open",
        },
        fields=["name", "pos_profile"],
        order_by="period_start_date desc",
    )
    data = ""
    if len(open_vouchers) > 0:
        data = {}
        data["pos_opening_shift"] = frappe.get_doc(
            "POS Opening Shift", open_vouchers[0]["name"]
        )
        update_opening_shift_data(data, open_vouchers[0]["pos_profile"])
    return data


def update_opening_shift_data(data, pos_profile):
    data["pos_profile"] = frappe.get_doc("POS Profile", pos_profile)
    if data["pos_profile"].get("posa_language"):
        frappe.local.lang = data["pos_profile"].posa_language
    data["company"] = frappe.get_doc("Company", data["pos_profile"].company)
    allow_negative_stock = frappe.get_value(
        "Stock Settings", None, "allow_negative_stock"
    )
    data["stock_settings"] = {}
    data["stock_settings"].update({"allow_negative_stock": allow_negative_stock})
