import jp from 'jsonpath';

export const templatePathParser = (body: object, input: string) => {
    const regex = /\|(.*?)\|/g; // Regular expression to match text between pipes
    const matches = input.match(regex);

    let output = input;
    if (matches) {
        matches.forEach(occurrence => {
            let jsonPathExpression = occurrence.slice(1, -1);
            let result = jp.query(body, jsonPathExpression);
            output = output.replaceAll(occurrence, result.length > 1 ? result.join(', ') : result.length == 0 ? '' : result[0])
        });
    }

    return output;
}