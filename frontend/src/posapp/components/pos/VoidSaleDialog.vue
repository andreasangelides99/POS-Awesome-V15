<template>
	<v-dialog :model-value="modelValue" persistent max-width="520" @update:model-value="$emit('update:modelValue', $event)">
		<v-card>
			<v-card-title class="text-h6 text-error">{{ __("Cancel this sale?") }}</v-card-title>
			<v-card-text>
				<p class="mb-2">
					{{ __("{0} item(s), {1}. A supervisor must approve, and the cancel is recorded.", [lines, money]) }}
				</p>
				<v-select v-model="reason" :items="reasons" :label="__('Why is the sale being cancelled?')" density="comfortable"></v-select>
				<v-text-field v-model="note" :label="reason === 'Other' ? __('Say what happened (required)') : __('Note (optional)')" density="comfortable"></v-text-field>
				<v-divider class="my-2"></v-divider>
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
				<div v-if="error" class="text-error">{{ error }}</div>
			</v-card-text>
			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn color="error" variant="flat" :loading="busy" :disabled="!ready" @click="submit">{{ __("Approve and cancel sale") }}</v-btn>
				<v-btn color="warning" @click="close">{{ __("Back") }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script>
// Cake Zone (owner, 19 Nov 2026): cancelling a sale needs a supervisor. A supervisor may approve
// their own with a reason; approving a cashier's, they give a reason too. offline/cz_voids.js.
import { approversFor, approveCancel, currentUser, newClientId } from "../../../offline/cz_voids.js";

export default {
	props: {
		modelValue: Boolean,
		till: { type: String, default: "" },
		items: { type: Array, default: () => [] },
		draft: { type: String, default: "" },
		currency: { type: Function, default: (v) => String(v) },
	},
	emits: ["update:modelValue", "confirm"],
	data() {
		return { reasons: [], approvers: [], reason: "", note: "", approver: "", password: "", approver_reason: "", error: "", busy: false, me: "" };
	},
	computed: {
		lines() {
			return this.items.length;
		},
		value() {
			return this.items.reduce((s, i) => s + (Number(i.rate) || 0) * (Number(i.qty) || 0), 0);
		},
		money() {
			return this.currency(this.value);
		},
		ready() {
			if (!this.reason || !this.approver || !this.password) return false;
			if (this.reason === "Other" && !this.note.trim()) return false;
			if (this.approver !== this.me && !this.approver_reason.trim()) return false;
			return true;
		},
	},
	watch: {
		async modelValue(open) {
			if (!open) return;
			Object.assign(this, { reason: "", note: "", password: "", approver_reason: "", error: "", busy: false, me: currentUser() });
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
				await approveCancel(record, this.password);
				this.password = "";
				this.$emit("confirm");
			} catch (e) {
				this.error = (e && e.message) || String(e);
			} finally {
				this.busy = false;
			}
		},
	},
};
</script>
