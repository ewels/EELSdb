type EelsdbAccount = { signed_in: boolean; name?: string; initials?: string; hue?: string; avatar?: string | null; theme?: string; at?: number };

interface Window {
  eelsdbAccount: { current: EelsdbAccount | null; render(link: HTMLAnchorElement, account: EelsdbAccount | null): void };
}
