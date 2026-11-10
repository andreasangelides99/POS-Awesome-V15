<template>
	<v-dialog :model-value="true" persistent max-width="480">
		<v-card>
			<v-card-title class="text-h6">{{ __("Set up offline sign-in on this till") }}</v-card-title>
			<v-card-text>
				<p class="mb-3">
					{{ __("Type your password once more. Then, if the internet goes down, you can still sign in on this till, open it and sell. Your sales are sent in your name when the internet is back.") }}
				</p>
				<v-text-field
					v-model="password"
					type="password"
					:label="__('Your password')"
					autocomplete="off"
					@keyup.enter="submit"
				></v-text-field>
				<div v-if="error" class="text-error">{{ error }}</div>
			</v-card-text>
			<v-card-actions>
				<v-btn variant="text" :disabled="busy" @click="$emit('done', false)">{{ __("Not now") }}</v-btn>
				<v-spacer></v-spacer>
				<v-btn color="primary" variant="flat" :loading="busy" :disabled="!password" @click="submit">
					{{ __("Set up") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script>
// Cake Zone (10 Nov 2026): once per person per till PC, while online. The server checks the
// password and issues this person a key for this PC (offline/cz_offline.js enroll()).
import { enroll } from "../../../offline/index.js";

export default {
	emits: ["done"],
	data() {
		return { password: "", error: "", busy: false };
	},
	methods: {
		async submit() {
			if (!this.password) return;
			this.busy = true;
			this.error = "";
			try {
				await enroll(this.password);
				this.password = "";
				this.eventBus && this.eventBus.emit("show_message", {
					title: __("Offline sign-in is set up on this till."),
					color: "success",
				});
				this.$emit("done", true);
			} catch (e) {
				let msg = "";
				try {
					const raw = (frappe.last_response || {})._server_messages;
					if (raw) msg = JSON.parse(raw).map((m) => JSON.parse(m).message || "").join(" ");
				} catch (err) {
					/* use the fallback */
				}
				this.error = (msg || (e && e.message) || __("That did not work. Try again.")).replace(/<[^>]*>/g, "");
			} finally {
				this.busy = false;
			}
		},
	},
};
</script>
