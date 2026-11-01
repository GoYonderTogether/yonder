import { useEffect, useRef, useState } from "react";
import { approximateCoordinates, VISIBILITY_LABEL } from "../../market/listingPolicy";
import type { Coordinates, ListingVisibility } from "../../market/types";

export interface PublishPolicy {
	location: string;
	coordinates: Coordinates | null;
	visibility: ListingVisibility;
	duration: string;
}
export function PublishPolicyFields({
	value,
	policyAvailable,
	editing,
	disabled,
	onChange,
	onError,
	onBusy,
}: {
	value: PublishPolicy;
	policyAvailable: boolean;
	editing: boolean;
	disabled: boolean;
	onChange: (patch: Partial<PublishPolicy>) => void;
	onError: (message: string) => void;
	onBusy: (value: boolean) => void;
}) {
	const [locating, setLocating] = useState(false);
	const version = useRef(0);
	useEffect(
		() => () => {
			version.current++;
		},
		[],
	);
	const locate = () => {
		if (!policyAvailable) return;
		if (!navigator.geolocation) {
			onError("当前浏览器无法定位，可手动填写地点。");
			return;
		}
		const request = ++version.current;
		setLocating(true);
		onBusy(true);
		navigator.geolocation.getCurrentPosition(
			(position) => {
				if (request !== version.current) return;
				try {
					onChange({ coordinates: approximateCoordinates(position.coords.latitude, position.coords.longitude) });
				} catch (error) {
					onError(error instanceof Error ? error.message : "定位失败");
				}
				setLocating(false);
				onBusy(false);
			},
			(error) => {
				if (request !== version.current) return;
				onError(error.code === 1 ? "未获定位权限，仍可手动填写地点或不附地点。" : "定位失败，请重试或手动填写地点。");
				setLocating(false);
				onBusy(false);
			},
			{ enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
		);
	};
	return (
		<>
			<label className="mk-form-label">
				{policyAvailable ? "地点（可选）" : "地点（必填）"}
				<input
					placeholder="城市、附近地点或线上"
					aria-required={!policyAvailable}
					value={value.location}
					disabled={disabled || locating}
					onChange={(event) => onChange({ location: event.target.value })}
				/>
			</label>
			{policyAvailable && (
				<div className="flex flex-wrap items-center gap-3 text-small">
					<button type="button" className="mk-button" disabled={disabled || locating} onClick={locate}>
						{locating ? "定位中…" : "附上当前位置"}
					</button>
					{value.coordinates && (
						<>
							<span>已附近似定位</span>
							<button
								type="button"
								className="mk-button"
								disabled={disabled || locating}
								onClick={() => onChange({ coordinates: null })}
							>
								移除定位
							</button>
						</>
					)}
				</div>
			)}
			{policyAvailable ? (
				<div className="mk-form-grid">
					<label className="mk-form-label">
						谁可以看
						<select
							value={value.visibility}
							disabled={disabled || locating}
							onChange={(event) => onChange({ visibility: event.target.value as ListingVisibility })}
						>
							{Object.entries(VISIBILITY_LABEL).map(([key, label]) => (
								<option key={key} value={key}>
									{label}
								</option>
							))}
						</select>
					</label>
					<label className="mk-form-label">
						有效期
						<select
							value={value.duration}
							disabled={disabled || locating}
							onChange={(event) => onChange({ duration: event.target.value })}
						>
							{editing && <option value="keep">保持原有效期</option>}
							<option value="forever">长期有效</option>
							{[1, 3, 7, 30].map((day) => (
								<option key={day} value={String(day)}>
									{day} 天
								</option>
							))}
						</select>
					</label>
				</div>
			) : (
				<p className="mk-form-hint">市场服务正在更新，可见范围、有效期与定位暂未开放。普通公开发布可继续使用。</p>
			)}
		</>
	);
}
