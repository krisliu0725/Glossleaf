import type {ColorSchemeId} from './appearance'
export type LogoPaletteId='ink-vermilion'|'teal-vermilion'|'ink-ochre'|'tea-vermilion'|'teal-ochre'|'vermilion-ink'
import type { ReaderPreferences } from './reader'
import type { Result } from './ipc'
export type ThemePreference = 'system' | 'light' | 'dark'
export interface AppPreferences { logoPalette:LogoPaletteId; colorScheme:ColorSchemeId; theme: ThemePreference; dark: boolean; locale: 'zh' | 'en' | null; reader:ReaderPreferences }
export interface Diagnostics { generatedAt:string; appVersion:string; platform:string; architecture:string; electron:string; node:string; schemaVersion:number|null; serviceReady:boolean; rendererCount:number; memory:{workingSetKb:number;privateKb:number}|null; index:{total:number;completed:number;failed:number;pages:number}|null; scope:string }
export interface PreferencesApi {
 get():Promise<Result<AppPreferences>>
 set(value:{colorScheme?:ColorSchemeId;logoPalette?:LogoPaletteId;theme?:ThemePreference;locale?:'zh'|'en';reader?:Partial<ReaderPreferences>}):Promise<Result<AppPreferences>>
 diagnostics():Promise<Result<Diagnostics>>
 saveDiagnostics():Promise<Result<{canceled:boolean;path?:string}>>
 saveUsage():Promise<Result<{canceled:boolean;path?:string}>>
}
