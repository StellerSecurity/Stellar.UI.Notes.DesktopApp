import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'striphtml'
})
export class StriphtmlPipe implements PipeTransform {

  transform(value: string): any {

    const parser = new DOMParser;

    value = value.replace("<br>", " ");
    value = value.replace("<div>", " ");

    value = value.replace(/<[^>]*>/g, '');

    const dom = parser.parseFromString(value, 'text/html');
    if (typeof dom.body.textContent === "string") {
      value = dom.body.textContent;
    }

    return value;
  }

}
