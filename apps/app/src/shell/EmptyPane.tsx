export function EmptyPane({ message }: { message: string }) {
	return <main className="grid flex-1 place-items-center bg-ground text-small text-faint">{message}</main>;
}
