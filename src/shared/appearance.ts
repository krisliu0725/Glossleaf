/** Application surfaces only. Stored annotation colors and brand assets keep their own palettes. */
export const COLOR_SCHEME_IDS = ['paper', 'celadon', 'pine', 'sandalwood', 'indigo', 'lotus'] as const
export type ColorSchemeId = typeof COLOR_SCHEME_IDS[number]
export interface SchemeColors { paper:string; inset:string; raised:string; ink:string; secondary:string; muted:string; line:string; control:string; accent:string; teal:string; ochre:string }
export interface ColorScheme { id:ColorSchemeId; zh:string; en:string; light:SchemeColors; dark:SchemeColors }
const colors=(paper:string,inset:string,raised:string,ink:string,secondary:string,muted:string,line:string,control:string,accent:string,teal:string,ochre:string):SchemeColors=>({paper,inset,raised,ink,secondary,muted,line,control,accent,teal,ochre})
export const COLOR_SCHEMES:readonly ColorScheme[]=[
 {id:'paper',zh:'纸墨',en:'Paper & Ink',light:colors('#f8f7f3','#f0eee8','#fffefb','#22221f','#53554f','#656860','#dadbd3','#777d71','#913e32','#386874','#89661e'),dark:colors('#1b1d1a','#151714','#232620','#e9ebe4','#b8bcb1','#a0a69a','#3d4238','#858d7d','#e8a28f','#9bcbd0','#e5c67a')},
 {id:'celadon',zh:'青瓷',en:'Celadon',light:colors('#f3f6f2','#e9efea','#fcfefb','#263b35','#485e54','#5e7067','#d0ddd4','#738579','#496d5b','#376c6a','#82682f'),dark:colors('#19231f','#141c19','#222e27','#e1ede4','#b5cabb','#9caf9f','#384c3f','#7a927e','#adc8ae','#9ac9c3','#d8c282')},
 {id:'pine',zh:'松烟',en:'Pine Soot',light:colors('#f4f5f2','#e9ece7','#fcfdf9','#29352c','#4c5b4c','#606e5c','#d0d8cd','#76856e','#53633f','#49675c','#7d6733'),dark:colors('#1c211b','#161a15','#272e23','#e7ecde','#bfcbb3','#a6b399','#424b38','#859575','#c0c99b','#a6c6b2','#dbc586')},
 {id:'sandalwood',zh:'檀香',en:'Sandalwood',light:colors('#f8f3eb','#efe6d8','#fffaf2','#3e3025','#665547','#766453','#dfd0bd','#96806b','#81523d','#4c6c61','#856023'),dark:colors('#271f19','#201913','#34291f','#f1e5d4','#d1bda5','#baa38b','#564332','#a18a70','#e4b18d','#aec5b0','#e6c17e')},
 {id:'indigo',zh:'黛蓝',en:'Indigo',light:colors('#f3f5f7','#e8edf1','#fcfdff','#2a3545','#4b5c70','#5c6c82','#d1dae4','#7c8b9f','#4a6082','#3b6c79','#826530'),dark:colors('#1b212c','#151b25','#262f3e','#e5eaf3','#bbc7dc','#a4b3cc','#3e4a60','#8997af','#b0c4e7','#9bc8d4','#ddc28e')},
 {id:'lotus',zh:'藕荷',en:'Lotus Ash',light:colors('#f7f3f4','#efe8eb','#fffafb','#3e3039','#68525f','#7a6370','#dfd1d8','#9b818e','#82566c','#526d69','#86632d'),dark:colors('#281f25','#21191e','#362a32','#f1e4eb','#d4bac9','#baa1af','#58434f','#a98c9c','#e2acc6','#b1c9c0','#e4c28b')}
]
export const colorScheme=(id:unknown):ColorScheme=>COLOR_SCHEMES.find(s=>s.id===id)??COLOR_SCHEMES[0]
