package benchdb

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

type measurementReader interface {
	Get([]byte) ([]byte, io.Closer, error)
}

func writeMeasurement(batch *pebble.Batch, key string, value measurement) error {
	encoded, err := marshalMeasurement(batch, value)
	if err != nil {
		return err
	}
	return batch.Set([]byte(key), encoded, nil)
}

// Fixed-size binary references replace repeated source, display, policy and
// ordered samples. Legacy JSON remains readable during copied-data migration.
func marshalMeasurement(batch *pebble.Batch, value measurement) ([]byte, error) {
	header := []byte{2, 0}
	objects := [][]byte{nil, nil, nil, nil}
	if value.Source != nil {
		objects[0] = encode(value.Source)
	}
	if value.Display != nil {
		objects[1] = encode(value.Display)
	}
	if value.Sampling != nil {
		objects[2] = encode(value.Sampling)
	}
	if len(value.SamplesNs) > 0 {
		objects[3] = encodeSamples(value.SamplesNs)
	}
	for index, object := range objects {
		if object == nil {
			continue
		}
		id := wire.Hash(object)
		key := fmt.Sprintf("objects/%d/%s", index, id)
		old, err := get(batch, key)
		if errors.Is(err, pebble.ErrNotFound) {
			if err = batch.Set([]byte(key), object, nil); err != nil {
				return nil, err
			}
		} else if err != nil {
			return nil, err
		} else if string(old) != string(object) {
			return nil, fmt.Errorf("conflicting measurement object")
		}
		ref, err := hex.DecodeString(id)
		if err != nil {
			return nil, err
		}
		header[1] |= 1 << index
		header = append(header, ref...)
	}
	value.Source, value.Display, value.Sampling, value.SamplesNs = nil, nil, nil, nil
	return append(header, encode(value)...), nil
}

func unmarshalMeasurement(reader measurementReader, encoded []byte, value *measurement) error {
	*value = measurement{}
	if len(encoded) > 0 && encoded[0] == '{' {
		return json.Unmarshal(encoded, value)
	}
	if len(encoded) < 2 || encoded[0] != 2 || encoded[1]&0xf0 != 0 {
		return fmt.Errorf("invalid measurement encoding")
	}
	flags, data := encoded[1], encoded[2:]
	objects := [4][]byte{}
	for index := range objects {
		if flags&(1<<index) == 0 {
			continue
		}
		if len(data) < 32 {
			return fmt.Errorf("truncated measurement reference")
		}
		id := hex.EncodeToString(data[:32])
		data = data[32:]
		object, err := get(reader, fmt.Sprintf("objects/%d/%s", index, id))
		if err != nil {
			return err
		}
		if wire.Hash(object) != id {
			return fmt.Errorf("corrupt measurement object")
		}
		objects[index] = object
	}
	if err := json.Unmarshal(data, value); err != nil {
		return err
	}
	if objects[0] != nil {
		if err := json.Unmarshal(objects[0], &value.Source); err != nil {
			return err
		}
	}
	if objects[1] != nil {
		if err := json.Unmarshal(objects[1], &value.Display); err != nil {
			return err
		}
	}
	if objects[2] != nil {
		if err := json.Unmarshal(objects[2], &value.Sampling); err != nil {
			return err
		}
	}
	if objects[3] != nil {
		samples, err := decodeSamples(objects[3])
		if err != nil {
			return err
		}
		value.SamplesNs = samples
		if len(samples) != value.TimingSamples {
			return fmt.Errorf("sample count differs from measurement")
		}
	}
	return nil
}
