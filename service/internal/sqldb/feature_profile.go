package sqldb

import (
	"context"
	"database/sql"
	"errors"
)

func putFeatureProfile(ctx context.Context, tx *sql.Tx, observation int64, profile string) error {
	if profile == "" {
		return nil
	}
	profileID, err := id(ctx, tx, "INSERT OR IGNORE INTO feature_profiles(name) VALUES(?)", "SELECT id FROM feature_profiles WHERE name=?", []any{profile}, []any{profile})
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO observation_profiles(observation_id,profile_id) VALUES(?,?)", observation, profileID)
	return err
}
func loadFeatureProfile(ctx context.Context, q queryer, observation int64) (string, error) {
	var profile string
	err := q.QueryRowContext(ctx, "SELECT p.name FROM observation_profiles op JOIN feature_profiles p ON p.id=op.profile_id WHERE op.observation_id=?", observation).Scan(&profile)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return profile, err
}
func featureProfiles(ctx context.Context, q queryer) (map[int64]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT op.observation_id,p.name FROM observation_profiles op JOIN feature_profiles p ON p.id=op.profile_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]string{}
	for rows.Next() {
		var observation int64
		var profile string
		if err = rows.Scan(&observation, &profile); err != nil {
			return nil, err
		}
		out[observation] = profile
	}
	return out, rows.Err()
}
