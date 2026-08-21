export interface RuntimeUser {
  uid: number;
  gid: number;
  uname: string;
  gname: string;
}

export const PAIRING_USER: RuntimeUser = {
  uid: 1001,
  gid: 1001,
  uname: "pairing",
  gname: "pairing",
};

export function tmpfsOptions(user: RuntimeUser, sizeMb: number): string {
  return `rw,noexec,nosuid,size=${sizeMb}m,uid=${user.uid},gid=${user.gid},mode=700`;
}
