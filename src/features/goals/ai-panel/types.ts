export type PiUiState =
	| {
			type: "select";
			interactionId: string;
			title: string;
			options: string[];
	  }
	| {
			type: "confirm";
			interactionId: string;
			title: string;
			message: string;
	  }
	| {
			type: "input";
			interactionId: string;
			title: string;
			placeholder: string;
	  }
	| null;

export type View = "chat" | "history";
