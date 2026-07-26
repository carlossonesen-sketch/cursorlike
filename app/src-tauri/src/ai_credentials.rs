use std::path::PathBuf;

const LEGACY_KEY_NAME: &str = "VITE_OPENAI_API_KEY";
const ENV_KEY_NAME: &str = "OPENAI_API_KEY";

pub struct OpenAiCredential(String);

impl OpenAiCredential {
    pub(crate) fn as_backend_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CredentialSource {
    SavedBackendConfiguration,
    EnvironmentFallback,
}

pub struct ResolvedCredential {
    pub credential: OpenAiCredential,
    pub source: CredentialSource,
}

#[derive(Clone, PartialEq, Eq)]
pub enum CredentialStatus {
    Available(CredentialSource),
    Unavailable,
    AccessError,
}

fn parse_saved_key(contents: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }
        let (name, value) = line.split_once('=')?;
        if name.trim() != LEGACY_KEY_NAME {
            return None;
        }
        let value = value.trim().trim_matches(['\'', '"']);
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn candidate_configuration_files() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        candidates.push(current.join(".env"));
    }
    if let Ok(executable) = std::env::current_exe() {
        let mut directory = executable.parent();
        for _ in 0..8 {
            let Some(value) = directory else { break };
            candidates.push(value.join(".env"));
            directory = value.parent();
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates
}

fn read_saved_configuration(paths: &[PathBuf]) -> Result<Option<String>, String> {
    for path in paths {
        if !path.exists() {
            continue;
        }
        let contents = std::fs::read_to_string(path)
            .map_err(|_| "Existing backend credential configuration could not be accessed.".to_string())?;
        if let Some(value) = parse_saved_key(&contents) {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

fn resolve_values(
    saved: Result<Option<String>, String>,
    environment: Option<String>,
) -> Result<Option<ResolvedCredential>, String> {
    match saved {
        Ok(Some(value)) => Ok(Some(ResolvedCredential {
            credential: OpenAiCredential(value),
            source: CredentialSource::SavedBackendConfiguration,
        })),
        Err(error) => Err(error),
        Ok(None) => Ok(environment
            .filter(|value| !value.trim().is_empty())
            .map(|value| ResolvedCredential {
                credential: OpenAiCredential(value),
                source: CredentialSource::EnvironmentFallback,
            })),
    }
}

pub fn resolve_openai_credential() -> Result<Option<ResolvedCredential>, String> {
    resolve_values(
        read_saved_configuration(&candidate_configuration_files()),
        std::env::var(ENV_KEY_NAME).ok(),
    )
}

pub fn openai_credential_status() -> CredentialStatus {
    match resolve_openai_credential() {
        Ok(Some(value)) => CredentialStatus::Available(value.source),
        Ok(None) => CredentialStatus::Unavailable,
        Err(_) => CredentialStatus::AccessError,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secret(resolved: &ResolvedCredential) -> String {
        resolved.credential.as_backend_str().to_string()
    }

    #[test]
    fn saved_credential_has_precedence_without_environment() {
        let resolved = resolve_values(Ok(Some("saved-fake".into())), None).unwrap().unwrap();
        assert!(resolved.source == CredentialSource::SavedBackendConfiguration);
        assert_eq!(secret(&resolved), "saved-fake");
    }

    #[test]
    fn environment_is_fallback_only() {
        let fallback = resolve_values(Ok(None), Some("env-fake".into())).unwrap().unwrap();
        assert!(fallback.source == CredentialSource::EnvironmentFallback);
        assert_eq!(secret(&fallback), "env-fake");
        let saved = resolve_values(Ok(Some("saved-fake".into())), Some("env-fake".into())).unwrap().unwrap();
        assert!(saved.source == CredentialSource::SavedBackendConfiguration);
        assert_eq!(secret(&saved), "saved-fake");
    }

    #[test]
    fn absence_and_access_errors_are_distinct() {
        assert!(resolve_values(Ok(None), None).unwrap().is_none());
        match resolve_values(Err("safe access error".into()), Some("env-fake".into())) {
            Err(error) => assert_eq!(error, "safe access error"),
            Ok(_) => panic!("saved credential access errors must not silently fall back"),
        }
    }

    #[test]
    fn secret_types_are_not_serializable_or_debuggable() {
        let source = "VITE_OPENAI_API_KEY=fake-test-secret\nVITE_OPENAI_MODEL=test-model\n";
        assert_eq!(parse_saved_key(source).as_deref(), Some("fake-test-secret"));
        let status = CredentialStatus::Available(CredentialSource::SavedBackendConfiguration);
        let safe = match status {
            CredentialStatus::Available(_) => "available",
            CredentialStatus::Unavailable => "unavailable",
            CredentialStatus::AccessError => "error",
        };
        assert_eq!(serde_json::to_string(&safe).unwrap(), "\"available\"");
        assert!(!serde_json::to_string(&safe).unwrap().contains("fake-test-secret"));
    }

    #[test]
    fn saved_file_parser_ignores_other_values() {
        assert_eq!(parse_saved_key("OTHER=value\n"), None);
        assert_eq!(parse_saved_key("VITE_OPENAI_API_KEY=\n"), None);
        assert_eq!(parse_saved_key("# VITE_OPENAI_API_KEY=fake\n"), None);
    }
}
