<template>
	<div class="pos-main-container dynamic-container" :class="rtlClasses" :style="[responsiveStyles, rtlStyles]">
		<ClosingDialog></ClosingDialog>
		<Drafts></Drafts>
		<SalesOrders></SalesOrders>
		<Returns></Returns>
		<NewAddress></NewAddress>
		<MpesaPayments></MpesaPayments>
		<Variants></Variants>
		<OpeningDialog v-if="dialog" :dialog="dialog"></OpeningDialog>
		<OfflineSignIn v-if="czSignIn" @signed-in="czSignedIn"></OfflineSignIn>
		<OfflineEnrol v-if="czEnrol" @done="czEnrolDone"></OfflineEnrol>
		<v-dialog v-model="czBackOnline" max-width="480" persistent>
			<v-card>
				<v-card-title>{{ __("The internet is back") }}</v-card-title>
				<v-card-text>
					{{ __("Your offline sales are in ERP. Log in to carry on selling - your shift carries on.") }}
				</v-card-text>
				<v-card-actions>
					<v-btn variant="text" @click="czBackOnline = false; czBackLater = true">{{ __("Not now") }}</v-btn>
					<v-spacer></v-spacer>
					<v-btn color="primary" variant="flat" @click="czLogInAgain">{{ __("Log in") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
		<v-row v-show="!dialog" dense class="ma-0 dynamic-main-row">
			<v-col v-show="!payment && !showOffers && !coupons" xl="5" lg="5" md="5" sm="5" cols="12"
				class="pos dynamic-col">
				<ItemsSelector></ItemsSelector>
			</v-col>
			<v-col v-show="showOffers" xl="5" lg="5" md="5" sm="5" cols="12" class="pos dynamic-col">
				<PosOffers></PosOffers>
			</v-col>
			<v-col v-show="coupons" xl="5" lg="5" md="5" sm="5" cols="12" class="pos dynamic-col">
				<PosCoupons></PosCoupons>
			</v-col>
			<v-col v-show="payment" xl="5" lg="5" md="5" sm="5" cols="12" class="pos dynamic-col">
				<Payments></Payments>
			</v-col>

			<v-col xl="7" lg="7" md="7" sm="7" cols="12" class="pos dynamic-col">
				<Invoice></Invoice>
			</v-col>
		</v-row>
	</div>
</template>

<script>
import ItemsSelector from "./ItemsSelector.vue";
import Invoice from "./Invoice.vue";
import OpeningDialog from "./OpeningDialog.vue";
import Payments from "./Payments.vue";
import PosOffers from "./PosOffers.vue";
import PosCoupons from "./PosCoupons.vue";
import Drafts from "./Drafts.vue";
import SalesOrders from "./SalesOrders.vue";
import ClosingDialog from "./ClosingDialog.vue";
import NewAddress from "./NewAddress.vue";
import Variants from "./Variants.vue";
import Returns from "./Returns.vue";
import MpesaPayments from "./Mpesa-Payments.vue";
import OfflineSignIn from "./OfflineSignIn.vue";
import OfflineEnrol from "./OfflineEnrol.vue";
import {
	offlineTillOn,
	boundTill,
	isEnrolled,
	actor,
	applyActor,
	clearActor,
	afterSignIn,
} from "../../../offline/index.js";
import {
	getOpeningStorage,
	setOpeningStorage,
	clearOpeningStorage,
	initPromise,
	checkDbHealth,
	setTaxTemplate,
} from "../../../offline/index.js";
import { getCurrentInstance } from "vue";
import { usePosShift } from "../../composables/usePosShift.js";
import { useOffers } from "../../composables/useOffers.js";
// Import the cache cleanup function
import { clearExpiredCustomerBalances } from "../../../offline/index.js";
import { useResponsive } from "../../composables/useResponsive.js";
import { useRtl } from "../../composables/useRtl.js";

export default {
	setup() {
		const instance = getCurrentInstance();
		const responsive = useResponsive();
		const rtl = useRtl();
		const shift = usePosShift(() => {
			if (instance && instance.proxy) {
				instance.proxy.dialog = true;
			}
		});
		const offers = useOffers();
		return { ...responsive, ...rtl, ...shift, ...offers };
	},
	data: function () {
		return {
			dialog: false,
			czSignIn: false,
			czEnrol: false,
			czEnrolAsked: false,
			czBackOnline: false,
			czBackLater: false,

			payment: false,
			showOffers: false,
			coupons: false,
			itemsLoaded: false,
			customersLoaded: false,
		};
	},

	components: {
		ItemsSelector,
		Invoice,
		OpeningDialog,
		Payments,
		Drafts,
		ClosingDialog,

		Returns,
		PosOffers,
		PosCoupons,
		NewAddress,
		Variants,
		MpesaPayments,
		SalesOrders,
		OfflineSignIn,
		OfflineEnrol,
	},

	methods: {
		create_opening_voucher() {
			this.dialog = true;
		},
		get_pos_setting() {
			frappe.db.get_doc("POS Settings", undefined).then((doc) => {
				this.eventBus.emit("set_pos_settings", doc);
			});
		},
		// Cake Zone offline till (10 Nov 2026) --------------------------------------
		czSignedIn() {
			this.czSignIn = false;
			applyActor();
			const next = afterSignIn();
			if (next.resume) {
				const data = next.resume;
				this.pos_profile = data.pos_profile;
				this.pos_opening_shift = data.pos_opening_shift;
				this.eventBus.emit("register_pos_profile", data);
				this.eventBus.emit("set_company", data.company);
				this.eventBus.emit("show_message", {
					title: __("Signed in offline. Sales are kept on this till until the internet is back."),
					color: "warning",
				});
			} else if (next.blocked) {
				clearActor();
				this.eventBus.emit("show_message", { title: next.blocked, color: "error" });
				this.czSignIn = true;
			} else {
				this.dialog = true;
			}
		},
		czOfferEnrol() {
			if (this.czEnrolAsked || !offlineTillOn() || !boundTill()) return;
			if (isEnrolled(frappe.session.user)) return;
			this.czEnrolAsked = true;
			this.czEnrol = true;
		},
		czEnrolDone() {
			this.czEnrol = false;
		},
		czLogInAgain() {
			// Nothing is left on the PC to send (the dialog only shows then). The shift stays
			// open in ERP and carries on after the login.
			clearActor();
			window.location.replace("/login?redirect-to=" + encodeURIComponent("/app/posapp"));
		},
		checkLoadingComplete() {
			if (this.itemsLoaded && this.customersLoaded) {
				console.info("Loading completed");
			}
		},
	},

	mounted: function () {
		this.$nextTick(function () {
			this.check_opening_entry();
			this.get_pos_setting();
			this.eventBus.on("close_opening_dialog", () => {
				this.dialog = false;
			});
			this.eventBus.on("cz_offline_start", () => {
				if (actor()) this.czSignedIn();
				else this.czSignIn = true;
			});
			this.eventBus.on("cz_offer_enrol", () => this.czOfferEnrol());
			// "Set up offline sign-in" from the Menu or the opening window (owner, 10 Nov 2026):
			// so a supervisor can have every staff member set up, without opening shifts.
			this.czEnrolNow = () => {
				if (!offlineTillOn() || actor()) return;
				if (!boundTill()) {
					this.eventBus.emit("show_message", {
						title: __("This PC is not set up as a till yet. Set it up at /till-setup, in this browser."),
						color: "error",
					});
					return;
				}
				this.czEnrolAsked = true;
				this.czEnrol = true;
			};
			window.addEventListener("cz_enrol_now", this.czEnrolNow);
			// Asked once; "Not now" waits until the next reload, and selling carries on offline
			// meanwhile (those sales go with the seller's key, as before).
			this.eventBus.on("cz_back_online", () => {
				if (this.czBackLater || this.czBackOnline || !actor()) return;
				this.czBackOnline = true;
			});
			this.eventBus.on("register_pos_data", (data) => {
				this.pos_profile = data.pos_profile;
				this.get_offers(this.pos_profile.name, this.pos_profile);
				this.pos_opening_shift = data.pos_opening_shift;
				this.eventBus.emit("register_pos_profile", data);
				console.info("LoadPosProfile");
			});
			// When profile is registered directly from composables,
			// ensure offers are fetched as well
			this.eventBus.on("register_pos_profile", (data) => {
				if (data && data.pos_profile) {
					this.get_offers(data.pos_profile.name, data.pos_profile);
				}
			});
			this.eventBus.on("show_payment", (data) => {
				this.payment = data === "true";
				this.showOffers = false;
				this.coupons = false;
			});
			this.eventBus.on("show_offers", (data) => {
				this.showOffers = data === "true";
				this.payment = false;
				this.coupons = false;
			});
			this.eventBus.on("show_coupons", (data) => {
				this.coupons = data === "true";
				this.showOffers = false;
				this.payment = false;
			});
			this.eventBus.on("open_closing_dialog", () => {
				this.get_closing_data();
			});
			this.eventBus.on("submit_closing_pos", (data) => {
				this.submit_closing_pos(data);
			});

			this.eventBus.on("items_loaded", () => {
				this.itemsLoaded = true;
				this.checkLoadingComplete();
			});
			this.eventBus.on("customers_loaded", () => {
				this.customersLoaded = true;
				this.checkLoadingComplete();
			});
		});
	},
	beforeUnmount() {
		if (this.czEnrolNow) window.removeEventListener("cz_enrol_now", this.czEnrolNow);
		this.eventBus.off("close_opening_dialog");
		this.eventBus.off("cz_offline_start");
		this.eventBus.off("cz_offer_enrol");
		this.eventBus.off("register_pos_data");
		this.eventBus.off("register_pos_profile");
		this.eventBus.off("LoadPosProfile");
		this.eventBus.off("show_offers");
		this.eventBus.off("show_coupons");
		this.eventBus.off("open_closing_dialog");
		this.eventBus.off("submit_closing_pos");
		this.eventBus.off("items_loaded");
		this.eventBus.off("customers_loaded");
	},
	// In the created() or mounted() lifecycle hook
	created() {
		// Clean up expired customer balance cache on POS load
		clearExpiredCustomerBalances();
	},
};
</script>

<style scoped>
.dynamic-container {
	/* add space for the navbar with better spacing */
	/*padding-top: calc(25px + var(--dynamic-lg));*/
	/* Navbar height (25px) + larger spacing */
	transition: all 0.3s ease;
}

.dynamic-main-row {
	padding: 0;
	margin: 0;
}

.dynamic-col {
	padding: var(--dynamic-sm);
	transition: padding 0.3s ease;
	margin-top: var(--dynamic-sm);
	/* Add top margin for better separation */
}

@media (max-width: 768px) {
	.dynamic-container {
		padding-top: calc(56px + var(--dynamic-md));
		/* Consistent navbar height + medium spacing */
	}

	.dynamic-col {
		padding: var(--dynamic-xs);
		margin-top: var(--dynamic-xs);
	}
}
</style>
