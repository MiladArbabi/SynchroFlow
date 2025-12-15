import { FormattedMessage } from 'react-intl';

type Props = {
  id?: string;
  defaultMessage?: string;
};

export default function SafeMessage({ id, defaultMessage }: Props) {
  if (!id || typeof id !== 'string') {
    return <>{defaultMessage ?? ''}</>;
  }

  return <FormattedMessage id={id} defaultMessage={defaultMessage ?? id} />;
}