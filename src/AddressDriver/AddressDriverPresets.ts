import type { BigNumberish, PopulatedTransaction, Signer } from 'ethers';
import { BigNumber } from 'ethers';
import DripsHubTxFactory from '../DripsHub/DripsHubTxFactory';
import {
	validateCollectInput,
	validateEmitUserMetadataInput,
	validateReceiveDripsInput,
	validateSetDripsInput,
	validateSplitInput,
	validateSqueezeDripsInput
} from '../common/validators';
import { isNullOrUndefined, nameOf } from '../common/internals';
import Utils from '../utils';
import type { DripsReceiverStruct, Preset, SplitsReceiverStruct, SqueezeArgs, UserMetadata } from '../common/types';
import { DripsErrors } from '../common/DripsError';
import AddressDriverTxFactory from './AddressDriverTxFactory';

export namespace AddressDriverPresets {
	export type NewStreamFlowPayload = {
		signer: Signer;
		driverAddress: string;
		tokenAddress: string;
		currentReceivers: DripsReceiverStruct[];
		newReceivers: DripsReceiverStruct[];
		balanceDelta: BigNumberish;
		transferToAddress: string;
		userMetadata: UserMetadata[];
	};

	export type CollectFlowPayload = {
		signer: Signer;
		driverAddress: string;
		dripsHubAddress: string;
		userId: string;
		tokenAddress: string;
		maxCycles: BigNumberish;
		currentReceivers: SplitsReceiverStruct[];
		transferToAddress: string;
		squeezeArgs?: SqueezeArgs[];
	};

	/**
 * Pre-configured sets of contract calls that can be used as input to `Caller.callBatched` method.
 * @see `CallerClient` for more.
 *
 *
 * @example <caption>Example usage of `collectFlow`.</caption>
 * // Create a new `Caller`.
 * const caller = await CallerClient.create(provider);
 *
 * // Populate the flow's payload.
	const flowPayload: AddressDriverPresets.CollectFlowPayload = {
		driverAddress,
		dripsHubAddress,
		userId,
		tokenAddress,
		maxCycles,
		currentReceivers,
		transferToAddress
	};

	// Create a new `collectFlow` preset.
	const collectFlow = AddressDriverPresets.Presets.collectFlow(flowPayload);

	// Pass the preset to the `Caller`.
	const tx = await caller.callBatched(collectFlow);
	await tx.wait();
	*/
	export class Presets {
		/**
		 * Creates a new batch with the following sequence of calls:
		 * 1. `setDrips`
		 * 2. `emitUserMetadata`
		 *
		 * @see `AddressDriverClient`'s API for more details.
		 * @param  {CreateStreamFlowPayload} payload the flow's payload.
		 * @returns The preset.
		 * @throws {@link DripsErrors.addressError} if `payload.tokenAddress` or `payload.transferToAddress` is not valid.
		 * @throws {@link DripsErrors.argumentMissingError} if any of the required parameters is missing.
		 * @throws {@link DripsErrors.argumentError} if `payload.currentReceivers`' or `payload.newReceivers`' count exceeds the max allowed drips receivers.
		 * @throws {@link DripsErrors.dripsReceiverError} if any of the `payload.currentReceivers` or the `payload.newReceivers` is not valid.
		 * @throws {@link DripsErrors.dripsReceiverConfigError} if any of the receivers' configuration is not valid.
		 */
		public static async createNewStreamFlow(payload: NewStreamFlowPayload): Promise<Preset> {
			if (isNullOrUndefined(payload)) {
				throw DripsErrors.argumentMissingError(
					`Could not create stream flow: '${nameOf({ payload })}' is missing.`,
					nameOf({ payload })
				);
			}

			const {
				signer,
				userMetadata,
				tokenAddress,
				driverAddress,
				newReceivers,
				balanceDelta,
				currentReceivers,
				transferToAddress
			} = payload;

			if (!signer?.provider) {
				throw DripsErrors.argumentError(`Could not create collect flow: signer is not connected to a provider.`);
			}

			validateSetDripsInput(
				tokenAddress,
				currentReceivers?.map((r) => ({
					userId: r.userId.toString(),
					config: Utils.DripsReceiverConfiguration.fromUint256(BigNumber.from(r.config).toBigInt())
				})),
				newReceivers?.map((r) => ({
					userId: r.userId.toString(),
					config: Utils.DripsReceiverConfiguration.fromUint256(BigNumber.from(r.config).toBigInt())
				})),
				transferToAddress,
				balanceDelta
			);
			validateEmitUserMetadataInput(userMetadata);

			const addressDriverTxFactory = await AddressDriverTxFactory.create(signer, driverAddress);

			const setDripsTx = await addressDriverTxFactory.setDrips(
				tokenAddress,
				currentReceivers,
				balanceDelta,
				newReceivers,
				0,
				0,
				transferToAddress
			);

			const userMetadataAsBytes = userMetadata.map((m) => Utils.Metadata.createFromStrings(m.key, m.value));

			const emitUserMetadataTx = await addressDriverTxFactory.emitUserMetadata(userMetadataAsBytes);

			return [setDripsTx, emitUserMetadataTx];
		}

		/**
		 * Creates a new batch with the following sequence of calls:
		 * 1. `squeezeDrips` (optional) for each provided sender
		 * 2. `receiveDrips` (optional)
		 * 3. `split` (optional)
		 * 4. `collect`
		 *
		 * @see `AddressDriverClient` and `DripsHubClient`'s API for more details.
		 * @param  {CollectFlowPayload} payload the flow's payload.
		 * @param  {boolean} skipReceive skips the `receiveDrips` step.
		 * @param  {boolean} skipSplit  skips the `split` step.
		 * @returns The preset.
		 * @throws {@link DripsErrors.addressError} if `payload.tokenAddress` or the `payload.transferToAddress` address is not valid.
		 * @throws {@link DripsErrors.argumentMissingError} if any of the required parameters is missing.
		 * @throws {@link DripsErrors.argumentError} if `payload.maxCycles` or `payload.currentReceivers` is not valid.
		 * @throws {@link DripsErrors.splitsReceiverError} if any of the `payload.currentReceivers` is not valid.
		 */
		public static async createCollectFlow(
			payload: CollectFlowPayload,
			skipReceive: boolean = false,
			skipSplit: boolean = false
		): Promise<Preset> {
			if (isNullOrUndefined(payload)) {
				throw DripsErrors.argumentMissingError(
					`Could not create collect flow: '${nameOf({ payload })}' is missing.`,
					nameOf({ payload })
				);
			}

			const {
				signer,
				driverAddress,
				dripsHubAddress,
				userId,
				tokenAddress,
				maxCycles,
				currentReceivers,
				transferToAddress,
				squeezeArgs
			} = payload;

			if (!signer?.provider) {
				throw DripsErrors.argumentError(`Could not create collect flow: signer is not connected to a provider.`);
			}

			const flow: PopulatedTransaction[] = [];

			const dripsHubTxFactory = await DripsHubTxFactory.create(signer.provider, dripsHubAddress);

			squeezeArgs?.forEach(async (args) => {
				validateSqueezeDripsInput(args.userId, args.tokenAddress, args.senderId, args.historyHash, args.dripsHistory);

				const squeezeTx = await dripsHubTxFactory.squeezeDrips(
					userId,
					tokenAddress,
					args.senderId,
					args.historyHash,
					args.dripsHistory
				);

				flow.push(squeezeTx);
			});

			if (!skipReceive) {
				validateReceiveDripsInput(userId, tokenAddress, maxCycles);

				const receiveTx = await dripsHubTxFactory.receiveDrips(userId, tokenAddress, maxCycles);

				flow.push(receiveTx);
			}

			if (!skipSplit) {
				validateSplitInput(userId, tokenAddress, currentReceivers);

				const splitTx = await dripsHubTxFactory.split(userId, tokenAddress, currentReceivers);

				flow.push(splitTx);
			}

			validateCollectInput(tokenAddress, transferToAddress);

			const addressDriverTxFactory = await AddressDriverTxFactory.create(signer, driverAddress);

			const collectTx = await addressDriverTxFactory.collect(tokenAddress, transferToAddress);

			flow.push(collectTx);

			return flow;
		}
	}
}
