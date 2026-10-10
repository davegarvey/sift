## MODIFIED Requirements

### Requirement: siftctl authentication provisioning

The system SHALL provide a `pair <code> [--label LABEL]` command that redeems an 8-character agent pairing code for a token and stores it locally. Redemption SHALL send the label, defaulting to `siftctl on <hostname>`. The token SHALL be read from `SIFTCTL_TOKEN`, then the config file (`~/.config/siftctl/token`), created with owner-only permissions. `pair` SHALL overwrite the stored token only after successful redemption. `SIFTCTL_URL` SHALL override the base URL.

#### Scenario: Pair succeeds
- **WHEN** the user runs `siftctl pair <code>` with a valid code
- **THEN** the program SHALL redeem the code
- **AND** SHALL write the token to the config file with owner-only permissions
- **AND** SHALL print a confirmation

#### Scenario: Pair sends a default label
- **WHEN** the user runs `siftctl pair <code>` without `--label`
- **THEN** the redemption SHALL carry the label `siftctl on <hostname>`
- **AND** the Agents screen SHALL list the token under that label

#### Scenario: Pair with invalid code
- **WHEN** the user runs `siftctl pair <invalid-code>`
- **THEN** the program SHALL print the server's error
- **AND** SHALL exit non-zero
- **AND** SHALL NOT modify the stored token

#### Scenario: Environment token takes precedence
- **WHEN** `SIFTCTL_TOKEN` is set and the config file also exists
- **THEN** all commands SHALL authenticate with the environment token
