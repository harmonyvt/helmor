export async function isPermissionGranted(): Promise<boolean> {
	return (
		typeof Notification !== "undefined" && Notification.permission === "granted"
	);
}

export async function requestPermission(): Promise<NotificationPermission> {
	if (typeof Notification === "undefined") return "denied";
	return Notification.requestPermission();
}

export function sendNotification(opts: { title: string; body?: string }): void {
	if (
		typeof Notification !== "undefined" &&
		Notification.permission === "granted"
	) {
		new Notification(opts.title, { body: opts.body });
	}
}
