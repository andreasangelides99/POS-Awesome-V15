<template>
	<v-dialog :model-value="modelValue" persistent max-width="520" @update:model-value="$emit('update:modelValue', $event)">
		<v-card>
			<v-card-title class="text-h6 text-error">{{ __("Cancel this sale?") }}</v-card-title>
			<v-card-text>
				<p class="mb-2">
					{{ lastItem ? __("Taking off the last item cancels the sale ({0}). A supervisor must approve, and the cancel is recorded.", [money]) : __("{0} item(s), {1}. A supervisor must approve, and the cancel is recorded.", [lines, money]) }}
				</p>
				<v-select v-model="reason" :items="reasons" :label="__('Why is the sale being cancelled?')" density="comfortable"></v-select>
				<v-text-field v-model="note" :label="reason === 'Other' || noSupervisor ? __('Say what happened (required)') : __('Note (optional)')" density="comfortable"></v-text-field>
				<v-divider class="my-2"></v-divider>
				<v-checkbox
					v-if="canSkip"
					v-model="noSupervisor"
					density="compact"
					color="error"
					:label="__('No supervisor can approve (no internet, no supervisor signed up on this PC)')"
				></v-checkbox>
				<div v-if="noSupervisor" class="text-error mb-2">
					{{ __("The sale is cleared and recorded as NOT APPROVED. Head office follows every one up. Say in the note what happened and why no supervisor could approve.") }}
				</div>
				<template v-if="!noSupervisor">
				<v-select
					v-model="approver"
					:items="approvers"
					item-title="name"
					item-value="user"
					:label="__('Supervisor approving')"
					:no-data-text="__('No supervisor is set up for this till.')"
					density="comfortable"
				></v-select>
				<v-text-field
					v-model="password"
					type="password"
					autocomplete="off"
					:label="approver === me ? __('Your password') : __('Supervisor\'s password')"
					density="comfortable"
					@keyup.enter="submit"
				></v-text-field>
				<v-text-field
					v-if="approver && approver !== me"
					v-model="approver_reason"
					:label="__('Supervisor\'s reason (required)')"
					density="comfortable"
				></v-text-field>
				</template>
				<div v-if="error" class="text-error">{{ error }}</div>
			</v-card-text>
			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn color="error" variant="flat" :loading="busy" :disabled="!ready" @click="submit">{{ noSupervisor ? __("Cancel sale - NOT APPROVED") : __("Approve and cancel sale") }}</v-btn>
				<v-btn color="warning" @click="close">{{ __("Back") }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script>
// Cake Zone (owner, 19 Nov 2026): cancelling a sale needs a supervisor. A supervisor may approve
// their own with a reason; approving a cashier's, they give a reason too. offline/cz_voids.js.
import { approversFor, approveCancel, cancelNotApproved, offlineNow, currentUser, newClientId } from "../../../offline/cz_voids.js";

export default {
	props: {
		modelValue: Boolean,
		till: { type: String, default: "" },
		items: { type: Array, default: () => [] },
		draft: { type: String, default: "" },
		currency: { type: Function, default: (v) => String(v) },
		lastItem: { type: Boolean, default: false },
	},
	emits: ["update:modelValue", "confirm"],
	data() {
		return { reasons: [], approvers: [], reason: "", note: "", approver: "", password: "", approver_reason: "", error: "", busy: false, me: "", noSupervisor: false, offlineSeen: false, offlineAtOpen: false };
	},
	computed: {
		lines() {
			return this.items.length;
		},
		value() {
			return this.items.reduce((s, i) => s + (Number(i.rate) || 0) * (Number(i.qty) || 0), 0);
		},
		money() {
			return "R " + this.currency(this.value);
		},
		canSkip() {
			// only offered when ERP cannot be reached; online a supervisor's password is always needed
			return this.offlineSeen || this.offlineAtOpen;
		},
		ready() {
			if (this.noSupervisor) return !!this.reason && !!this.note.trim();
			if (!this.reason || !this.approver || !this.password) return false;
			if (this.reason === "Other" && !this.note.trim()) return false;
			if (this.approver !== this.me && !this.approver_reason.trim()) return false;
			return true;
		},
	},
	beforeUnmount() {
		window.removeEventListener("online", this.czNet);
		window.removeEventListener("offline", this.czNet);
	},
	mounted() {
		// navigator.onLine is not reactive: follow the browser's own online/offline events
		this.czNet = () => (this.offlineAtOpen = offlineNow());
		window.addEventListener("online", this.czNet);
		window.addEventListener("offline", this.czNet);
		// Save this till's supervisors while the line is up, so a cancel can be approved offline.
		if (this.till) approversFor(this.till);
	},
	watch: {
		till(t) {
			if (t) approversFor(t);
		},
		async modelValue(open) {
			if (!open) return;
			Object.assign(this, { reason: "", note: "", password: "", approver_reason: "", error: "", busy: false, me: currentUser(), noSupervisor: false, offlineSeen: false, offlineAtOpen: offlineNow() });
			const r = await approversFor(this.till);
			this.reasons = r.reasons || [];
			this.approvers = r.approvers || [];
			this.approver = this.approvers.some((a) => a.user === this.me) ? this.me : "";
		},
	},
	methods: {
		close() {
			this.password = "";
			this.$emit("update:modelValue", false);
		},
		async submit() {
			if (!this.ready || this.busy) return;
			this.busy = true;
			this.error = "";
			const record = {
				client_id: newClientId(),
				kind: "Sale cancelled",
				pos_profile: this.till,
				user: this.me,
				at: frappe.datetime.now_datetime(),
				value: this.value,
				draft_invoice: this.draft || "",
				items: this.items.map((i) => ({ item_code: i.item_code, item_name: i.item_name, qty: i.qty, rate: i.rate })),
				reason: this.reason,
				note: this.note.trim(),
				approver: this.approver,
				approver_reason: this.approver === this.me ? "" : this.approver_reason.trim(),
			};
			try {
				if (this.noSupervisor) await cancelNotApproved(record);
				else await approveCancel(record, this.password);
				this.password = "";
				this.$emit("confirm");
			} catch (e) {
				if (e && e.offline) this.offlineSeen = true;
				this.error = (e && e.message) || String(e);
			} finally {
				this.busy = false;
			}
		},
	},
};
</script>
