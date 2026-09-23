/* global frappe */
import {
        getOpeningStorage,
        setPrintTemplate,
        setBranchAddress,
        setTermsAndConditions,
} from "../offline/index.js";

async function cachePrintTemplateAndTerms(profile) {
        if (!profile || typeof frappe === "undefined" || !navigator.onLine) return;

        try {
                if (profile.print_format) {
                        const pf = await frappe.call({
                                method: "frappe.client.get_value",
                                args: {
                                        doctype: "Print Format",
                                        fieldname: "html",
                                        filters: { name: profile.print_format },
                                },
                        });
                        if (pf.message && pf.message.html) {
                                setPrintTemplate(pf.message.html);
                        }
                }
        } catch (e) {
                console.error("Failed to fetch print format", e);
        }

        // The branch address, rendered exactly as the server renders it onto the invoice.
        // An OFFLINE invoice is built in the browser and has no company_address_display -
        // that field is written server-side at validate - so without caching it here the
        // load-shedding receipt loses the two lines under the shop name.
        try {
                if (profile.company_address) {
                        const addr = await frappe.call({
                                method: "frappe.contacts.doctype.address.address.get_address_display",
                                args: { address_dict: profile.company_address },
                        });
                        if (addr && addr.message) {
                                setBranchAddress(addr.message);
                        }
                }
        } catch (e) {
                console.error("Failed to fetch branch address", e);
        }

        try {
                const termsName = profile.tc_name || profile.terms_and_conditions;
                if (termsName) {
                        const tc = await frappe.call({
                                method: "frappe.client.get_value",
                                args: {
                                        doctype: "Terms and Conditions",
                                        fieldname: "terms",
                                        filters: { name: termsName },
                                },
                        });
                        if (tc.message && tc.message.terms) {
                                setTermsAndConditions(tc.message.terms);
                        }
                }
        } catch (e) {
                console.error("Failed to fetch terms and conditions", e);
        }
}

export async function ensurePosProfile() {
        const bootProfile = frappe?.boot?.pos_profile;
        if (bootProfile && bootProfile.warehouse && bootProfile.selling_price_list) {
                await cachePrintTemplateAndTerms(bootProfile);
                return bootProfile;
        }
        try {
                const res = await frappe.call({
                        method: "posawesome.posawesome.api.utils.get_active_pos_profile",
                        args: { user: frappe.session.user },
                });
                if (res.message) {
                        frappe.boot.pos_profile = res.message;
                        await cachePrintTemplateAndTerms(res.message);
                        return res.message;
                }
        } catch (e) {
                console.error("Failed to fetch active POS profile", e);
        }
        const cached = getOpeningStorage();
        if (cached && cached.pos_profile) {
                await cachePrintTemplateAndTerms(cached.pos_profile);
                return cached.pos_profile;
        }
        await cachePrintTemplateAndTerms(bootProfile);
        return bootProfile || null;
}
