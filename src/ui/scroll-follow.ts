export const FOLLOW_THRESHOLD_PX = 80;

export type ScrollGeometry = { scrollHeight: number; clientHeight: number; scrollTop: number };

export function distanceFromBottom(geometry: ScrollGeometry): number {
  return geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop;
}

export function isNearBottom(geometry: ScrollGeometry): boolean {
  return distanceFromBottom(geometry) < FOLLOW_THRESHOLD_PX;
}

export type ScrollFollower = {
  following(): boolean;
  unread(): number;
  pin(): void;
  noteArrival(): void;
  dispose(): void;
};

export function createScrollFollower(element: HTMLElement, onChange: (state: { following: boolean; unread: number }) => void): ScrollFollower {
  let following = true;
  let unread = 0;
  let programmatic = false;

  const publish = () => onChange({ following, unread });

  const jump = () => {
    programmatic = true;
    element.scrollTop = element.scrollHeight;
    requestAnimationFrame(() => {
      if (following) element.scrollTop = element.scrollHeight;
      requestAnimationFrame(() => {
        programmatic = false;
      });
    });
  };

  const release = () => {
    if (!following) return;
    following = false;
    publish();
  };

  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) release();
  };

  const onTouchMove = () => {
    if (!isNearBottom(element)) release();
  };

  const onKey = (event: KeyboardEvent) => {
    if (["PageUp", "ArrowUp", "Home"].includes(event.key)) release();
  };

  const onScroll = () => {
    if (programmatic) return;
    const near = isNearBottom(element);
    if (near && !following) {
      following = true;
      unread = 0;
      publish();
    } else if (!near && following) {
      release();
    }
  };

  const follow = () => {
    if (following) jump();
  };

  const mutations = new MutationObserver(follow);
  const resizes = new ResizeObserver(follow);

  element.addEventListener("wheel", onWheel, { passive: true });
  element.addEventListener("touchmove", onTouchMove, { passive: true });
  element.addEventListener("keydown", onKey);
  element.addEventListener("scroll", onScroll, { passive: true });
  mutations.observe(element, { childList: true, subtree: true, characterData: true });
  resizes.observe(element);

  return {
    following: () => following,
    unread: () => unread,
    pin() {
      following = true;
      unread = 0;
      jump();
      publish();
    },
    noteArrival() {
      if (following) return;
      unread += 1;
      publish();
    },
    dispose() {
      mutations.disconnect();
      resizes.disconnect();
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("scroll", onScroll);
    },
  };
}
