<template>
	<v-dialog :model-value="true" persistent max-width="480">
		<v-card>
			<v-card-title class="text-h6">{{ __("No internet: sign in to this till") }}</v-card-title>
			<v-card-text>
				<p class="mb-3">
					{{ till ? __("This PC is {0}. The till works offline and sends everything to ERP when the internet is back.", [till]) : __("This PC is not set up as a till.") }}
				</p>
				<div v-if="!list.length" class="text-error mb-3">
					{{ __("Nobody has set up offline sign-in on this till yet. It is set up when a person opens this till while the internet works.") }}
				</div>
				<v-radio-group v-else v-model="user" :label="__('Who are you?')">
					<v-radio v-for="p in list" :key="p.user" :label="p.full_name" :value="p.user"></v-radio>
				</v-radio-group>
				<v-text-field
					v-model="password"
					type="password"
					:label="__('Your password')"
					autocomplete="off"
					:disabled="!list.length"
					@keyup.enter="submit"
				></v-text-field>
				<div v-if="error" class="text-error">{{ error }}</div>
			</v-card-text>
			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn color="primary" variant="flat" :loading="busy" :disabled="!user || !password" @click="submit">
					{{ __("Sign in") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script>
// Cake Zone (10 Nov 2026): the till's own sign-in when the server cannot be reached. The
// password is checked against the copy this PC keeps (offline/cz_offline.js); nothing is sent.
import { boundTill, peopleForTill, verify, setActor } from "../../../offline/index.js";

export default {
	emits: ["signed-in"],
	data() {
		const till = boundTill();
		const list = till ? peopleForTill(till) : [];
		return { till, list, user: list.length === 1 ? list[0].user : "", password: "", error: "", busy: false };
	},
	methods: {
		async submit() {
			if (!this.user || !this.password) return;
			this.busy = true;
			this.error = "";
			try {
				const p = await verify(this.user, this.password);
				if (!p) {
					this.error = __("That password is not right.");
					return;
				}
				setActor(p);
				this.password = "";
				this.$emit("signed-in", p);
			} catch (e) {
				this.error = (e && e.message) || String(e);
			} finally {
				this.busy = false;
			}
		},
	},
};
</script>
