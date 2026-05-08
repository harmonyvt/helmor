export type UnlistenFn = () => void;

export async function listen<T = unknown>(
	_event: string,
	_handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
	return () => {};
}
