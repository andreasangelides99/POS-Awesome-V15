import { ref, getCurrentInstance } from "vue";
import { getCachedOffers, saveOffers } from "../../offline/index.js";

export function useOffers() {
    const { proxy } = getCurrentInstance();
    const eventBus = proxy?.eventBus;
    const offers = ref([]);

    // Cake Zone (11 Nov 2026): only offers whose days include today. The server also sends the
    // coming week's, and the PC keeps them all, so a special starts and ENDS on its own days
    // even when the till has no internet (dates are YYYY-MM-DD, so they compare as text).
    function current(list) {
        const today = frappe.datetime.get_today();
        return (list || []).filter(
            (o) => (!o.valid_from || String(o.valid_from) <= today) && (!o.valid_upto || String(o.valid_upto) >= today),
        );
    }

    function get_offers(profileName, posProfile) {
        if (posProfile && posProfile.posa_local_storage) {
            const cached = current(getCachedOffers());
            if (cached.length) {
                offers.value = cached;
                eventBus?.emit("set_offers", cached);
            }
        }
        return frappe
            .call("posawesome.posawesome.api.offers.get_offers", { profile: profileName, ahead: 1 })
            .then((r) => {
                if (r.message) {
                    console.info("LoadOffers");
                    saveOffers(r.message);
                    const today = current(r.message);
                    offers.value = today;
                    eventBus?.emit("set_offers", today);
                }
            })
            .catch((err) => {
                console.error("Failed to fetch offers:", err);
                const cached = current(getCachedOffers());
                if (cached.length) {
                    offers.value = cached;
                    eventBus?.emit("set_offers", cached);
                }
            });
    }

    return { offers, get_offers };
}
