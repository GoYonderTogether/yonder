export function PageSkeleton() {
	return (
		<div role="status" aria-label="加载中" className="flex min-h-0 flex-1 flex-col gap-3 p-6">
			<div className="skeleton h-6 w-1/3 rounded-card" />
			<div className="skeleton h-24 rounded-card" />
			<div className="skeleton h-24 rounded-card" />
		</div>
	);
}
