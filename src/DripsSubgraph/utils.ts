import type { DripsSetEvent, DripsSetEventWithFullReceivers } from './types';

type ReceiversHash = string;

interface DripsReceiverSeenEvent {
	id: string;
	receiverUserId: string;
	config: bigint;
}

export const sortDripsSetEvents = <T extends DripsSetEvent>(dripsSetEvents: T[]): T[] =>
	dripsSetEvents.sort((a, b) => Number(a.blockTimestamp) - Number(b.blockTimestamp));

export const deduplicateArray = <T>(array: T[], key: keyof T): T[] => [
	...new Map(array.map((item) => [item[key], item])).values()
];

export const reconcileDripsSetReceivers = (dripsSetEvents: DripsSetEvent[]): DripsSetEventWithFullReceivers[] => {
	const sortedDripsSetEvents = sortDripsSetEvents(dripsSetEvents);

	const receiversHashes = sortedDripsSetEvents.reduce<ReceiversHash[]>((acc, dripsSetEvent) => {
		const { receiversHash } = dripsSetEvent;

		return !acc.includes(receiversHash) ? [...acc, receiversHash] : acc;
	}, []);

	const dripsReceiverSeenEventsByReceiversHash = receiversHashes.reduce<{
		[receiversHash: string]: DripsReceiverSeenEvent[];
	}>((acc, receiversHash) => {
		const receivers = deduplicateArray(
			sortedDripsSetEvents
				.filter((event) => event.receiversHash === receiversHash)
				.reduce<DripsReceiverSeenEvent[]>((accc, event) => [...accc, ...event.dripsReceiverSeenEvents], []),
			'config'
		);

		return {
			...acc,
			[receiversHash]: receivers
		};
	}, {});

	return sortedDripsSetEvents.reduce<DripsSetEventWithFullReceivers[]>(
		(acc, dripsSetEvent) => [
			...acc,
			{
				...dripsSetEvent,
				currentReceivers: dripsReceiverSeenEventsByReceiversHash[dripsSetEvent.receiversHash] ?? []
			}
		],
		[]
	);
};
