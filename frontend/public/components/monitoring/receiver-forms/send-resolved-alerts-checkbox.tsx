import { useTranslation } from 'react-i18next';
import { Checkbox, FormGroup } from '@patternfly/react-core';

export const SendResolvedAlertsCheckbox = ({ formField, formValues, dispatchFormChange }) => {
  const { t } = useTranslation();
  return (
    <FormGroup>
      <Checkbox
        label={t('public~Send resolved alerts to this receiver?')}
        onChange={(_event, checked) =>
          dispatchFormChange({ type: 'setFormValues', payload: { [formField]: checked } })
        }
        isChecked={formValues[formField]}
        id={formField}
        data-test="send-resolved-alerts"
      />
    </FormGroup>
  );
};
