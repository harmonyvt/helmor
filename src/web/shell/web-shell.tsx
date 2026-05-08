import { useEffect, useState } from "react";
import type { WebShellProps } from "../types";
import PhoneShell from "./phone-shell";
import TabletShell from "./tablet-shell";

type DeviceClass = "phone" | "tablet";

function useDeviceClass(): DeviceClass {
	const [deviceClass, setDeviceClass] = useState<DeviceClass>(() =>
		window.matchMedia("(min-width: 640px)").matches ? "tablet" : "phone",
	);

	useEffect(() => {
		const mql = window.matchMedia("(min-width: 640px)");
		const onChange = (e: MediaQueryListEvent) => {
			setDeviceClass(e.matches ? "tablet" : "phone");
		};
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, []);

	return deviceClass;
}

export default function WebShell(props: WebShellProps) {
	const deviceClass = useDeviceClass();

	if (deviceClass === "tablet") {
		return <TabletShell {...props} />;
	}
	return <PhoneShell {...props} />;
}
