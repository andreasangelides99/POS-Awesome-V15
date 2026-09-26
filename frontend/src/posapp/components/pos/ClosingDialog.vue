<template>
	<v-row justify="center">
		<v-dialog v-model="closingDialog" max-width="900px" persistent>
			<v-card elevation="8" class="closing-dialog-card">
				<!-- Enhanced White Header -->
				<v-card-title class="closing-header pa-6">
					<div class="header-content">
						<div class="header-icon-wrapper">
							<v-icon class="header-icon" size="40">mdi-store-clock-outline</v-icon>
						</div>
						<div class="header-text">
							<h3 class="header-title">{{ __("Closing POS Shift") }}</h3>
							<p class="header-subtitle">
								{{ __("Reconcile payment methods and close shift") }}
							</p>
						</div>
					</div>
				</v-card-title>

				<v-divider class="header-divider"></v-divider>

				<v-card-text class="pa-0 white-background">
					<v-container class="pa-6">
						<v-row v-if="floatKept">
							<v-col cols="12" class="pa-1">
								<div class="table-header mb-4">
									<h4 class="text-h6 text-grey-darken-2 mb-1">
										{{ __("Count the drawer") }}
									</h4>
									<p class="text-body-2 text-grey">
										{{ __("Every note and coin. The total below becomes the cash you declare.") }}
									</p>
								</div>
								<v-row dense>
									<v-col v-for="d in denominations" :key="d.key" cols="6" sm="4" md="2">
										<v-text-field
											v-model.number="d.count"
											:label="d.label"
											type="number"
											min="0"
											density="compact"
											variant="outlined"
											color="primary"
											hide-details
											:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
											class="dark-field"
											@update:model-value="applyCount"
										></v-text-field>
									</v-col>
								</v-row>
								<v-row dense class="mt-2">
									<v-col cols="12" sm="4">
										<v-text-field :label="__('Cash counted')" :model-value="fmt(cashCounted)"
											density="compact" variant="outlined" hide-details disabled
											class="dark-field"></v-text-field>
									</v-col>
									<v-col cols="12" sm="4">
										<v-text-field :label="__('Float kept in the till')" :model-value="fmt(floatKept)"
											density="compact" variant="outlined" hide-details disabled
											class="dark-field"></v-text-field>
									</v-col>
									<v-col cols="12" sm="4">
										<v-text-field :label="__('CASH TO BANK')" :model-value="fmt(cashToBank)"
											density="compact" variant="outlined" hide-details disabled
											color="primary" class="dark-field"></v-text-field>
									</v-col>
								</v-row>
								<p class="text-body-2 text-grey mt-2">
									{{ __("Bank the cash-to-bank figure, coins included, and keep exactly the float. The deposit slip must show this amount.") }}
								</p>
							</v-col>
						</v-row>

						<v-row>
							<v-col cols="12" class="pa-1">
								<div class="table-header mb-4">
									<h4 class="text-h6 text-grey-darken-2 mb-1">
										{{ __("Payment Reconciliation") }}
									</h4>
									<p class="text-body-2 text-grey">
										{{ __("Verify closing amounts for each payment method") }}
									</p>
								</div>

								<v-data-table
									:headers="headers"
									:items="dialog_data.payment_reconciliation"
									item-key="mode_of_payment"
									class="elevation-0 rounded-lg white-table"
									:items-per-page="itemsPerPage"
									hide-default-footer
									density="compact"
								>
									<template v-slot:item.closing_amount="props">
										<v-text-field
											v-model="props.item.closing_amount"
											:rules="[max25chars]"
											:label="frappe._('Edit')"
											single-line
											counter
											type="number"
											density="compact"
											variant="outlined"
											color="primary"
											:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
											class="dark-field"
											hide-details
											:prefix="currencySymbol(pos_profile.currency)"
										></v-text-field>
									</template>
									<template v-slot:item.difference="{ item }">
										{{ currencySymbol(pos_profile.currency) }}
										{{
											item.difference = formatCurrency(
												item.expected_amount - item.closing_amount,
											)
										}}</template
									>
									<template v-slot:item.opening_amount="{ item }">
										{{ currencySymbol(pos_profile.currency) }}
										{{ formatCurrency(item.opening_amount) }}</template
									>
									<template v-slot:item.expected_amount="{ item }">
										{{ currencySymbol(pos_profile.currency) }}
										{{ formatCurrency(item.expected_amount) }}</template
									>
								</v-data-table>
							</v-col>
						</v-row>
					</v-container>
				</v-card-text>

				<v-divider></v-divider>
				<v-card-actions class="dialog-actions-container">
					<v-btn
						theme="dark"
						@click="submit_dialog"
						class="pos-action-btn submit-action-btn"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-check-circle-outline</v-icon>
						<span>{{ __("Submit") }}</span>
					</v-btn>
					<v-spacer></v-spacer>
					<v-btn
						theme="dark"
						@click="close_dialog"
						class="pos-action-btn cancel-action-btn"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-close-circle-outline</v-icon>
						<span>{{ __("Close") }}</span>
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script>
import format from "../../format";
export default {
	mixins: [format],
	data: () => ({
		closingDialog: false,
		itemsPerPage: 20,
		dialog_data: {},
		// South African denominations in circulation. 1c, 2c and 5c went in 2002.
		denominations: [
			{ key: "custom_n_r200", label: "R200", value: 200, count: null },
			{ key: "custom_n_r100", label: "R100", value: 100, count: null },
			{ key: "custom_n_r50", label: "R50", value: 50, count: null },
			{ key: "custom_n_r20", label: "R20", value: 20, count: null },
			{ key: "custom_n_r10", label: "R10", value: 10, count: null },
			{ key: "custom_n_r5", label: "R5", value: 5, count: null },
			{ key: "custom_n_r2", label: "R2", value: 2, count: null },
			{ key: "custom_n_r1", label: "R1", value: 1, count: null },
			{ key: "custom_n_c50", label: "50c", value: 0.5, count: null },
			{ key: "custom_n_c20", label: "20c", value: 0.2, count: null },
			{ key: "custom_n_c10", label: "10c", value: 0.1, count: null },
		],
		pos_profile: "",
		headers: [
			{
				title: __("Mode of Payment"),
				value: "mode_of_payment",
				align: "start",
				sortable: true,
			},
			{
				title: __("Opening Amount"),
				align: "end",
				sortable: true,
				value: "opening_amount",
			},
			{
				title: __("Closing Amount"),
				value: "closing_amount",
				align: "end",
				sortable: true,
			},
		],
		max25chars: (v) => v.length <= 20 || "Input too long!", // TODO : should validate as number
		pagination: {},
	}),
	watch: {},

	methods: {
		close_dialog() {
			this.closingDialog = false;
		},
		fmt(v) {
			return `${this.currencySymbol(this.pos_profile?.currency)} ${(v || 0).toFixed(2)}`;
		},
		/* Write the count onto the payload AND onto the Cash row, so one number never
		   lives in two places disagreeing. The server recomputes it all on validate
		   using the real Mode of Payment types, so this is convenience, not the gate. */
		applyCount() {
			if (!this.floatKept) return;
			this.denominations.forEach((d) => {
				this.dialog_data[d.key] = parseFloat(d.count) || 0;
			});
			const total = this.cashCounted;
			(this.dialog_data.payment_reconciliation || []).forEach((r) => {
				if (String(r.mode_of_payment || "").toLowerCase().includes("cash")) {
					r.closing_amount = total;
				}
			});
		},
		submit_dialog() {
			const invalid = (this.dialog_data.payments || []).some((p) =>
				isNaN(parseFloat(p.closing_amount)),
			);
			if (invalid) {
				alert(this.__("Invalid closing amount"));
				return;
			}
			this.eventBus.emit("submit_closing_pos", this.dialog_data);
			this.closingDialog = false;
		},
	},

	computed: {
		/* The float is CONFIGURED on the till, never typed - an imprecise float is a
		   place to hide a shortage. If it is not set, the pad stays hidden and the
		   dialog behaves exactly as it did before. */
		floatKept() {
			return parseFloat(this.pos_profile?.custom_cash_float) || 0;
		},
		cashCounted() {
			return this.denominations.reduce(
				(t, d) => t + (parseFloat(d.count) || 0) * d.value, 0);
		},
		cashToBank() {
			return Math.max(0, this.cashCounted - this.floatKept);
		},
		isDarkTheme() {
			return this.$theme.current === "dark";
		},
	},

	created: function () {
		this.eventBus.on("open_ClosingDialog", (data) => {
			/* Clear the denomination pad on EVERY open. This component is mounted
			   once and reused, so without this the counts from the previous close
			   are still sitting there - and a drawer that happens to look right
			   would be declared without anybody recounting it. Exactly the stale
			   -state trap the sales person had in the offline submit path.

			   dialog_data is deliberately NOT touched: the server falls back to the
			   typed amount when no denominations are entered, so zeroing the Cash
			   row here would overwrite a fresh payload for no reason. applyCount
			   takes over the moment she types the first number. */
			this.denominations.forEach((d) => {
				d.count = null;
			});
			this.closingDialog = true;
			this.dialog_data = data;
		});
		this.eventBus.on("register_pos_profile", (data) => {
			this.pos_profile = data.pos_profile;
			if (!this.pos_profile.hide_expected_amount) {
				this.headers.push({
					title: __("Expected Amount"),
					value: "expected_amount",
					align: "end",
					sortable: false,
				});
				this.headers.push({
					title: __("Difference"),
					value: "difference",
					align: "end",
					sortable: false,
				});
			}
		});
	},
	beforeUnmount() {
		this.eventBus.off("open_ClosingDialog");
		this.eventBus.off("register_pos_profile");
	},
};
</script>

<style scoped>
/* Enhanced Header Styles */
.closing-header {
	background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
	border-bottom: 1px solid #e0e0e0;
	padding: 24px !important;
}

.header-content {
	display: flex;
	align-items: center;
	gap: 20px;
	width: 100%;
}

.header-icon-wrapper {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 64px;
	height: 64px;
	background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
	border-radius: 16px;
	box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
}

.header-icon {
	color: white !important;
}

.header-text {
	flex: 1;
}

.header-title {
	font-size: 1.5rem;
	font-weight: 600;
	color: #1a1a1a;
	margin: 0 0 4px 0;
	line-height: 1.2;
}

.header-subtitle {
	font-size: 0.95rem;
	color: #666;
	margin: 0;
	font-weight: 400;
}

.header-divider {
	border-color: #e0e0e0;
}

.white-background {
	background-color: #ffffff;
}

.table-header {
	padding: 0 4px;
}

.white-table {
	background-color: white;
	border: 1px solid #e0e0e0;
}

/* Action Buttons */
.dialog-actions-container {
	background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
	border-top: 1px solid #e0e0e0;
	padding: 16px 24px;
	gap: 12px;
}

.pos-action-btn {
	border-radius: 12px;
	text-transform: none;
	font-weight: 600;
	padding: 12px 32px;
	min-width: 120px;
	transition: all 0.3s ease;
	color: white !important;
	/* Add this line */
}

/* Add these new rules: */
.pos-action-btn .v-icon {
	color: white !important;
}

.pos-action-btn span {
	color: white !important;
}

.pos-action-btn:disabled .v-icon,
.pos-action-btn:disabled span {
	color: white !important;
}

.cancel-action-btn {
	background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%) !important;
}

.submit-action-btn {
	background: linear-gradient(135deg, #388e3c 0%, #2e7d32 100%) !important;
}

.submit-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(46, 125, 50, 0.4);
}

.cancel-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(211, 47, 47, 0.4);
}

.submit-action-btn:disabled {
	opacity: 0.6;
	transform: none;
}

/* Dark theme overrides */
:deep([data-theme="dark"]) .closing-dialog-card,
:deep(.v-theme--dark) .closing-dialog-card,
::v-deep([data-theme="dark"]) .closing-dialog-card,
::v-deep(.v-theme--dark) .closing-dialog-card {
	background: #1e1e1e !important;
}

:deep([data-theme="dark"]) .closing-header,
:deep(.v-theme--dark) .closing-header,
::v-deep([data-theme="dark"]) .closing-header,
::v-deep(.v-theme--dark) .closing-header {
	background: #1e1e1e !important;
	color: #fff !important;
	border-bottom: 1px solid #373737;
}

:deep([data-theme="dark"]) .white-background,
:deep(.v-theme--dark) .white-background,
::v-deep([data-theme="dark"]) .white-background,
::v-deep(.v-theme--dark) .white-background {
	background-color: #1e1e1e !important;
}

:deep([data-theme="dark"]) .white-table,
:deep(.v-theme--dark) .white-table,
::v-deep([data-theme="dark"]) .white-table,
::v-deep(.v-theme--dark) .white-table {
	background-color: #1e1e1e !important;
}

:deep([data-theme="dark"]) .dialog-actions-container,
:deep(.v-theme--dark) .dialog-actions-container,
::v-deep([data-theme="dark"]) .dialog-actions-container,
::v-deep(.v-theme--dark) .dialog-actions-container {
	background: #1e1e1e !important;
	border-top: 1px solid #373737;
}

/* And the responsive section: */
@media (max-width: 768px) {
	.dialog-actions-container {
		flex-direction: column;
		gap: 12px;
	}

	.pos-action-btn {
		width: 100%;
	}
}
</style>
