import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { credentialIdentity } from '../../shared/providers'
import type { ProviderConfig } from '../../shared/m3'

interface Codec { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
/** Every secret is bound to an explicit protocol+endpoint, never a global fallback. */
export class CredentialVault {
  constructor(private directory: string, private codec: Codec) {}
  private profiles(legacyConfig: ProviderConfig | null): Record<string, string> {
    const file = join(this.directory, 'profiles.enc')
    if (existsSync(file)) {
      if (!this.codec.available()) throw new Error('安全存储暂不可用，请解锁系统钥匙串后重试')
      try {
        const raw = JSON.parse(this.codec.decrypt(readFileSync(file)))
        if (!raw || Array.isArray(raw) || typeof raw !== 'object' || Object.values(raw).some(v => typeof v !== 'string')) throw 0
        return raw
      } catch { throw new Error('无法读取 API 密钥，请重新配置；不会发送其他端点的密钥') }
    }
    const legacy = join(this.directory, 'provider.enc')
    if (legacyConfig && existsSync(legacy) && readFileSync(legacy).length) {
      if (!this.codec.available()) throw new Error('安全存储暂不可用')
      return { [credentialIdentity(legacyConfig)]: this.codec.decrypt(readFileSync(legacy)) }
    }
    return {}
  }
  migrate(legacyConfig: ProviderConfig | null): void {
    if (!existsSync(join(this.directory, 'profiles.enc')) && legacyConfig && existsSync(join(this.directory, 'provider.enc'))) {
      const profiles = this.profiles(legacyConfig)
      this.set(legacyConfig, profiles[credentialIdentity(legacyConfig)] ?? '', legacyConfig)
    }
  }
  get(config: ProviderConfig, legacyConfig: ProviderConfig | null): string {
    return this.profiles(legacyConfig)[credentialIdentity(config)] ?? ''
  }
  set(config: ProviderConfig, value: string, legacyConfig: ProviderConfig | null): void {
    if (!this.codec.available()) throw new Error('安全存储不可用，API Key 未保存')
    const profiles = this.profiles(legacyConfig), identity = credentialIdentity(config)
    if (value) profiles[identity] = value; else delete profiles[identity]
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = join(this.directory, 'profiles.enc')
    writeFileSync(file + '.tmp', this.codec.encrypt(JSON.stringify(profiles)), { mode: 0o600 })
    renameSync(file + '.tmp', file)
  }
}
