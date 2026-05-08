//! Workspace kind enum -- distinguishes normal code workspaces from Goal
//! workspaces. Stored in `workspaces.workspace_kind` and serialized to the
//! frontend as `"code" | "goal"`.

use std::fmt;
use std::str::FromStr;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    #[default]
    Code,
    Goal,
}

impl WorkspaceKind {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Goal => "goal",
        }
    }
}

impl fmt::Display for WorkspaceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug)]
pub struct UnknownWorkspaceKind(pub String);

impl fmt::Display for UnknownWorkspaceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown workspace kind: {:?}", self.0)
    }
}

impl std::error::Error for UnknownWorkspaceKind {}

impl FromStr for WorkspaceKind {
    type Err = UnknownWorkspaceKind;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "code" => Ok(Self::Code),
            "goal" => Ok(Self::Goal),
            other => Err(UnknownWorkspaceKind(other.to_string())),
        }
    }
}

impl FromSql for WorkspaceKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse()
            .map_err(|e: UnknownWorkspaceKind| FromSqlError::Other(Box::new(e)))
    }
}

impl ToSql for WorkspaceKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(ValueRef::Text(
            self.as_str().as_bytes(),
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_serialization_matches_storage_literals() {
        for kind in [WorkspaceKind::Code, WorkspaceKind::Goal] {
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, format!("\"{}\"", kind.as_str()));
            let round: WorkspaceKind = serde_json::from_str(&json).unwrap();
            assert_eq!(round, kind);
        }
    }
}
